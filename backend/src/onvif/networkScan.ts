import { isTcpPortReachable } from "../lib/tcpCheck.js";
import { isRtspServer, guessRtspPath } from "../lib/rtspProbe.js";
import { discoverStreams, type DiscoveredStream } from "./device.js";
import { logger } from "../lib/logger.js";

/**
 * Common HTTP ports ONVIF's device service listens on across different
 * camera brands/firmwares (80 is by far the most common; the others cover
 * cheap OEM cameras seen in this project - Yoosee-style devices often use
 * 5000, some use 8000/8080/2020). Checked in order, first one that's open
 * wins - cameras don't expose ONVIF on more than one port at a time.
 */
const ONVIF_PORTS = [80, 8080, 8000, 2020, 5000];
const RTSP_PORT = 554;
/** Short timeout per port check - this runs against up to MAX_HOSTS addresses, most of which won't even exist on the network, so it needs to fail fast. */
const PORT_CHECK_TIMEOUT_MS = 700;
/** Bounds how long a single ONVIF connect+profile-list attempt can take during a scan - unlike connecting to one already-known camera (device.ts's connectToDevice retries generously), here we're probing many candidate hosts and can't afford to retry/wait long on ones that turn out not to be cameras (e.g. a router's or printer's web UI sitting on port 80). */
const ONVIF_PROBE_TIMEOUT_MS = 8000;
const CONCURRENCY = 12;

export interface ScanCredentials {
  username?: string;
  password?: string;
}

export interface ScanHostResult {
  host: string;
  /** True only if port 554 actually spoke RTSP (a real `OPTIONS` handshake got a valid `RTSP/1.0 <code>` reply) - not just "the TCP port is open", which says nothing about what's listening on it. */
  rtspOpen: boolean;
  /** A guessed working RTSP path (e.g. "/live/ch0"), tried from a list of common camera URL patterns - only attempted as a fallback when RTSP is confirmed open but ONVIF didn't already resolve an authoritative stream URI. Null if not attempted or nothing matched. */
  rtspPath: string | null;
  onvifPort: number | null;
  onvif: {
    ok: boolean;
    error?: string;
    streams?: DiscoveredStream[];
  } | null;
}

export type ScanEvent =
  | { type: "start"; totalHosts: number }
  | { type: "host-start"; host: string }
  | ({ type: "host-result" } & ScanHostResult)
  | { type: "done" }
  | { type: "error"; message: string };

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function findOpenOnvifPort(host: string): Promise<number | null> {
  for (const port of ONVIF_PORTS) {
    // eslint-disable-next-line no-await-in-loop
    if (await isTcpPortReachable(host, port, PORT_CHECK_TIMEOUT_MS)) {
      return port;
    }
  }
  return null;
}

/**
 * A real RTSP protocol check, not just a TCP connect: first confirms the
 * port is even open (fails fast for the vast majority of scanned
 * addresses, which don't exist at all), then sends an actual `OPTIONS`
 * handshake to rule out "something else is listening on 554" (port
 * forwarding, an unrelated service, etc).
 */
async function checkRtsp(host: string): Promise<boolean> {
  const tcpOpen = await isTcpPortReachable(host, RTSP_PORT, PORT_CHECK_TIMEOUT_MS);
  if (!tcpOpen) return false;
  return isRtspServer(host, RTSP_PORT);
}

async function scanHost(host: string, creds: ScanCredentials): Promise<ScanHostResult> {
  const [rtspOpen, onvifPort] = await Promise.all([checkRtsp(host), findOpenOnvifPort(host)]);

  let onvif: ScanHostResult["onvif"] = null;
  if (onvifPort !== null && creds.username) {
    try {
      const streams = await withTimeout(
        discoverStreams({
          host,
          port: onvifPort,
          onvifPath: "/onvif/device_service",
          username: creds.username,
          password: creds.password ?? "",
        }),
        ONVIF_PROBE_TIMEOUT_MS,
        "Tempo esgotado ao tentar conectar via ONVIF (provavelmente não é uma câmera ONVIF, ou as credenciais não conferem)."
      );
      onvif = { ok: true, streams };
    } catch (err) {
      onvif = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Only bother brute-forcing a path if RTSP is confirmed AND ONVIF didn't
  // already give us an authoritative stream URI - a guess is strictly a
  // fallback for cameras without (working) ONVIF.
  let rtspPath: string | null = null;
  if (rtspOpen && !(onvif?.ok && onvif.streams && onvif.streams.length > 0)) {
    rtspPath = await guessRtspPath(host, RTSP_PORT);
  }

  return { host, rtspOpen, rtspPath, onvifPort, onvif };
}

/**
 * Active network scan for ONVIF/RTSP cameras across an IP range - the
 * fallback for when WS-Discovery (`onvif/discovery.ts`) finds nothing,
 * which happens routinely when this app runs inside Docker: WS-Discovery
 * relies on receiving multicast UDP replies, which typically never reach a
 * container on a default bridge network. This instead only makes regular
 * outbound TCP connections (same as `nmap -p 554 --script rtsp-url-brute`),
 * which work identically from inside Docker as from any other LAN client.
 *
 * Progress is reported incrementally via `onEvent` (host-by-host) so a
 * caller can stream it to the user in real time instead of waiting for the
 * whole range to finish, which can take a while for larger ranges.
 */
export async function scanNetwork(
  hosts: string[],
  creds: ScanCredentials,
  onEvent: (event: ScanEvent) => void
): Promise<ScanHostResult[]> {
  const results: ScanHostResult[] = [];
  let index = 0;

  async function worker() {
    for (;;) {
      const current = index++;
      if (current >= hosts.length) return;
      const host = hosts[current];
      onEvent({ type: "host-start", host });
      try {
        const result = await scanHost(host, creds);
        results.push(result);
        onEvent({ type: "host-result", ...result });
      } catch (err) {
        logger.warn({ err, host }, "Network scan failed unexpectedly for host");
        onEvent({ type: "host-result", host, rtspOpen: false, rtspPath: null, onvifPort: null, onvif: null });
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, hosts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
