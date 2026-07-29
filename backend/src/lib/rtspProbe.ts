import net from "node:net";

interface RtspResponse {
  statusCode: number | undefined;
  raw: string;
}

/**
 * Sends a single raw RTSP request over a fresh TCP connection and parses
 * the status line of the first response. Resolves as soon as the
 * end-of-headers blank line is seen (RTSP OPTIONS/DESCRIBE responses used
 * here never carry a body worth waiting for), rather than waiting for the
 * socket to close - most RTSP servers keep the connection open.
 */
function rtspRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 2000
): Promise<RtspResponse> {
  return new Promise((resolve, reject) => {
    const url = `rtsp://${host}:${port}${path}`;
    const headerLines = Object.entries({ CSeq: "1", ...extraHeaders }).map(([k, v]) => `${k}: ${v}`);
    const requestText = `${method} ${url} RTSP/1.0\r\n${headerLines.join("\r\n")}\r\n\r\n`;

    const socket = new net.Socket();
    let settled = false;
    const chunks: Buffer[] = [];

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(() => reject(new Error("RTSP timeout"))));
    socket.once("error", (err) => finish(() => reject(err)));
    socket.once("connect", () => socket.write(requestText));
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).includes("\r\n\r\n")) {
        finish(() => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const statusLine = raw.split("\r\n")[0] ?? "";
          const statusMatch = statusLine.match(/^RTSP\/\d\.\d (\d+)/);
          resolve({ statusCode: statusMatch ? Number(statusMatch[1]) : undefined, raw: statusLine });
        });
      }
    });
    socket.once("end", () => finish(() => reject(new Error("Connection closed with no response"))));
    socket.connect(port, host);
  });
}

/**
 * Confirms a TCP port actually speaks RTSP, instead of just being open -
 * many things sit on port 554 or get port-forwarded there, and a bare TCP
 * connect (the previous check here) can't tell an RTSP camera apart from
 * an unrelated service. Sends a real `OPTIONS` request and checks for a
 * valid `RTSP/1.0 <code>` status line in the reply.
 */
export async function isRtspServer(host: string, port = 554, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await rtspRequest(host, port, "OPTIONS", "/", {}, timeoutMs);
    return res.statusCode !== undefined;
  } catch {
    return false;
  }
}

/**
 * Common RTSP URL paths used by cheap/OEM/NVR cameras across brands -
 * mirrors the path list nmap's `rtsp-url-brute` script tries. Only
 * consulted as a fallback for cameras where ONVIF isn't available/didn't
 * resolve a stream URI (ONVIF's own `GetStreamUri` is always authoritative
 * over a guess when it works).
 */
const COMMON_RTSP_PATHS = [
  "/",
  "/live",
  "/live.sdp",
  "/live/ch0",
  "/live/ch00_0",
  "/live/0/h264.sdp",
  "/h264",
  "/h264.sdp",
  "/stream1",
  "/stream/1",
  "/video1",
  "/videoMain",
  "/onvif1",
  "/onvif2",
  "/cam/realmonitor?channel=1&subtype=0",
  "/Streaming/Channels/101",
  "/media.smp",
  "/mpeg4",
  "/12",
];

/**
 * Tries each path in `COMMON_RTSP_PATHS` in sequence (one at a time, not
 * in parallel: several cameras in this project's real-world testing only
 * tolerate a single concurrent RTSP session - see media/vlcRelay.ts),
 * stopping at the first one that gets a real RTSP response. `401`/`403`
 * still count as a hit (the path exists, it just needs auth we didn't
 * send) - only `404`/no-response/5xx are treated as "not this path",
 * matching how nmap's own script interprets results.
 */
export async function guessRtspPath(host: string, port = 554, timeoutMs = 1500): Promise<string | null> {
  for (const path of COMMON_RTSP_PATHS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await rtspRequest(host, port, "DESCRIBE", path, { Accept: "application/sdp" }, timeoutMs);
      if (res.statusCode && res.statusCode < 500 && res.statusCode !== 404) {
        return path;
      }
    } catch {
      // Try the next path.
    }
  }
  return null;
}
