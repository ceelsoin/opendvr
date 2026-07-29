export interface NetworkScanStream {
  profileToken: string;
  name: string;
  encoding: string | null;
  width: number | null;
  height: number | null;
  rtspUri: string;
}

export interface NetworkScanHostResult {
  host: string;
  /** True only if a real RTSP `OPTIONS` handshake succeeded on port 554 - not just "the port is open". */
  rtspOpen: boolean;
  /** A guessed working RTSP path (e.g. "/live/ch0"), tried from a list of common camera URL patterns - only present when RTSP is open and ONVIF didn't already resolve a stream URI. */
  rtspPath: string | null;
  onvifPort: number | null;
  onvif: {
    ok: boolean;
    error?: string;
    streams?: NetworkScanStream[];
  } | null;
}

export type NetworkScanEvent =
  | { type: "start"; totalHosts: number }
  | { type: "host-start"; host: string }
  | ({ type: "host-result" } & NetworkScanHostResult)
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Streams newline-delimited JSON progress events from
 * `POST /api/discovery/scan` as they arrive, instead of waiting for the
 * whole (potentially slow, up to hundreds of hosts) scan to finish - powers
 * the terminal-style scan modal (OnvifScanModal). Uses the native `fetch`
 * API rather than axios: axios's browser adapter buffers the full response
 * before resolving and doesn't expose a readable stream of it.
 */
export async function streamNetworkScan(
  input: { range: string; username?: string; password?: string },
  onEvent: (event: NetworkScanEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch("/api/discovery/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    throw new Error((data as { error?: string } | null)?.error ?? `Falha ao iniciar a varredura (HTTP ${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as NetworkScanEvent);
      } catch {
        // Malformed/partial line - ignore rather than aborting the whole scan.
      }
    }
  }
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer) as NetworkScanEvent);
    } catch {
      // Ignore a trailing partial line.
    }
  }
}
