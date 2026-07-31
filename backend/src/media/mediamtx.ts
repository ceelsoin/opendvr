import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export interface MediaMtxPathConfig {
  source: string;
  sourceOnDemand?: boolean;
  /**
   * Forcing "tcp" avoids UDP packet loss/NAT traversal issues that are
   * common with cheap/OEM cameras and containerized deployments; "automatic"
   * (MediaMTX's default) tries UDP first, which can add delay or silently
   * fail on some networks before falling back.
   */
  rtspTransport?: "udp" | "multicast" | "tcp" | "automatic";
  record?: boolean;
  recordPath?: string;
  recordFormat?: "fmp4" | "mpegts";
  recordSegmentDuration?: string;
  recordDeleteAfter?: string;
}

async function request(path: string, init?: RequestInit): Promise<void> {
  const url = `${env.mediamtxApiUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MediaMTX API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requestJson(path: string, init?: RequestInit): Promise<any> {
  const url = `${env.mediamtxApiUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MediaMTX API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * Creates or updates (upsert) the path configuration for a camera, so
 * MediaMTX starts pulling its RTSP stream and, when enabled, recording it
 * to disk natively (no ffmpeg involved).
 */
export async function upsertCameraPath(pathName: string, config: MediaMtxPathConfig): Promise<void> {
  await request(`/v3/config/paths/replace/${encodeURIComponent(pathName)}`, {
    method: "POST",
    body: JSON.stringify(config),
  });
  logger.info({ pathName }, "MediaMTX path registered");
}

/** Derives the MediaMTX path name used for a camera's sub-stream (lower-resolution profile), when one is available - see media/provisioning.ts's `provisionSubStreamPath` and frontend quality-switching in CameraTile.tsx. */
export function subStreamPathName(cameraId: string): string {
  return `${cameraId}_sub`;
}

/** Removes a camera's path configuration from MediaMTX (e.g. on camera deletion). */
export async function deleteCameraPath(pathName: string): Promise<void> {
  try {
    await request(`/v3/config/paths/delete/${encodeURIComponent(pathName)}`, { method: "DELETE" });
    logger.info({ pathName }, "MediaMTX path removed");
  } catch (err) {
    // Deleting a path that was never registered (e.g. provisioning failed
    // earlier) is not fatal - just log it.
    logger.warn({ err, pathName }, "Failed to remove MediaMTX path (it may not exist)");
  }
}

/**
 * Partially updates an already-registered path's config (merges into the
 * existing config instead of replacing it wholesale like upsertCameraPath).
 * Used to reactively flip `record` on/off for motion-triggered recording
 * without having to resend the full path config (source, transport, etc.).
 */
export async function patchCameraPath(pathName: string, partial: Partial<MediaMtxPathConfig>): Promise<void> {
  await request(`/v3/config/paths/patch/${encodeURIComponent(pathName)}`, {
    method: "PATCH",
    body: JSON.stringify(partial),
  });
}

export interface CameraPathStatus {
  /** Whether MediaMTX currently has a source connected (i.e. is actually receiving the RTSP stream). */
  ready: boolean;
  /** Whether the path has any config at all (false if never registered/already deleted). */
  configured: boolean;
  sourceType: string | null;
  readerCount: number;
  bytesReceived: number;
}

/**
 * Reads MediaMTX's live runtime view of a camera's path (is the RTSP source
 * actually connected and flowing, or just configured but never started?).
 * Used to tell apart "MediaMTX never even tried" from "MediaMTX tried and
 * failed to pull the RTSP stream" when a camera shows as online but the
 * player never starts.
 */
export async function getCameraPathStatus(pathName: string): Promise<CameraPathStatus> {
  try {
    const data = await requestJson(`/v3/paths/get/${encodeURIComponent(pathName)}`);
    return {
      configured: true,
      ready: Boolean(data?.ready),
      sourceType: data?.source?.type ?? null,
      readerCount: Array.isArray(data?.readers) ? data.readers.length : 0,
      bytesReceived: Number(data?.bytesReceived ?? 0),
    };
  } catch {
    return { configured: false, ready: false, sourceType: null, readerCount: 0, bytesReceived: 0 };
  }
}

export interface RecordingSegment {
  /** ISO 8601 start timestamp of the segment. */
  start: string;
  /** Segment duration in seconds. */
  duration: number;
}

/**
 * Lists recorded segments for a path (camera) within a time range, via
 * MediaMTX's Playback server (a separate HTTP server from the Control API,
 * see mediamtx.yml's `playback`/`playbackAddress`). Returns just start+
 * duration - callers build their own playback URL (proxied through this
 * backend's own /recordings route, see app.ts) rather than trusting the
 * absolute URL MediaMTX puts in its own response (which points at its
 * internal docker hostname, unreachable from the browser).
 */
export async function listRecordingSegments(
  pathName: string,
  start?: string,
  end?: string
): Promise<RecordingSegment[]> {
  const params = new URLSearchParams({ path: pathName });
  if (start) params.set("start", start);
  if (end) params.set("end", end);

  const url = `${env.mediamtxPlaybackUrl}/list?${params.toString()}`;
  const res = await fetch(url);
  if (res.status === 404) {
    // No recordings at all for this path yet.
    return [];
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MediaMTX playback API GET /list failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as Array<{ start: string; duration: number }>;
  return data.map((segment) => ({ start: segment.start, duration: segment.duration }));
}

/**
 * Fetches an actual recorded clip (as an MP4 buffer) via MediaMTX's
 * Playback server `/get` endpoint - same endpoint the Timeline's player
 * proxies through (see recordings.routes.ts) - for use as an attachment
 * in event notifications (see media/eventClip.ts). Returns `null` (instead
 * of throwing) for the expected "not there (yet)" cases - 404 (no
 * recording covers this range at all) and 400 (range not fully written
 * yet) - so callers can fall back to a snapshot without treating it as an
 * unexpected error.
 */
export async function getRecordingClip(pathName: string, start: string, durationSeconds: number): Promise<Buffer | null> {
  const params = new URLSearchParams({ path: pathName, start, duration: String(durationSeconds) });
  const url = `${env.mediamtxPlaybackUrl}/get?${params.toString()}`;
  const res = await fetch(url);
  if (res.status === 404 || res.status === 400) {
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MediaMTX playback API GET /get failed: ${res.status} ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export interface MediaMtxHealth {
  reachable: boolean;
  latencyMs: number | null;
}

/** Lightweight reachability/latency check against the Control API, for the Dashboard's process-health view - MediaMTX itself runs as a separate container/process, not something this backend spawns, so "is it up" needs an actual request rather than an in-memory flag. */
export async function checkMediaMtxHealth(): Promise<MediaMtxHealth> {
  const start = Date.now();
  try {
    await requestJson("/v3/paths/list");
    return { reachable: true, latencyMs: Date.now() - start };
  } catch {
    return { reachable: false, latencyMs: null };
  }
}

/** Subset of MediaMTX's global config relevant to HLS delivery tuning - see media/streamSettings.ts, which is the source of truth for the persisted values (this is just the shape of the PATCH body). */
export interface GlobalHlsConfig {
  hlsVariant?: "mpegts" | "fmp4" | "lowLatency";
  hlsSegmentCount?: number;
  hlsSegmentDuration?: string;
  hlsPartDuration?: string;
  hlsSegmentMaxSize?: string;
  hlsAlwaysRemux?: boolean;
  hlsMuxerCloseAfter?: string;
}

/**
 * Patches MediaMTX's GLOBAL configuration (`/v3/config/global/patch`) -
 * unlike `upsertCameraPath`/`patchCameraPath`, this affects every camera's
 * HLS output at once, since HLS segment/part tuning isn't a per-path
 * setting in MediaMTX. Applied at boot and whenever the Settings page's
 * stream section is saved (see media/streamSettings.ts).
 */
export async function patchGlobalConfig(partial: GlobalHlsConfig): Promise<void> {
  await request(`/v3/config/global/patch`, {
    method: "PATCH",
    body: JSON.stringify(partial),
  });
  logger.info({ partial }, "MediaMTX global config updated");
}
