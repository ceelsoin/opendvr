import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";

export interface RecordingSegment {
  /** ISO 8601 start timestamp. */
  start: string;
  /** Duration in seconds. */
  duration: number;
  /** Proxied playback URL (this backend's own origin, see app.ts's /recordings proxy). */
  url: string;
}

/** Lists recorded segments for a camera within [start, end] (ISO 8601), read from MediaMTX's Playback server. */
export function useRecordings(cameraId: string, start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ["recordings", cameraId, start, end],
    queryFn: async () => {
      const { data } = await apiClient.get<RecordingSegment[]>(`/recordings/${cameraId}`, {
        params: { start, end },
      });
      return data;
    },
    enabled: enabled && Boolean(cameraId),
  });
}

const DEFAULT_CLIP_WINDOW_SECONDS = 60;

/**
 * Builds a playback URL for an arbitrary start/duration within a camera's
 * recordings - MediaMTX's Playback `/get` endpoint accepts any start
 * timestamp + duration (duration is a *maximum*, not a requirement - it
 * just serves however many bytes actually exist from that point on), not
 * just whole recorded segments. Mirrors the URL pattern the backend itself
 * uses for whole-segment URLs (see backend/src/api/routes/recordings.routes.ts).
 *
 * `format: "mp4"` requests a standard (non-fragmented) MP4 instead of the
 * default fMP4 - used for downloads/exports, since fMP4 isn't reliably
 * recognized as a normal video file by OS file browsers/media players.
 */
export function buildRecordingClipUrl(
  cameraId: string,
  startIso: string,
  durationSeconds: number,
  format?: "mp4"
): string {
  const base = `/recordings/get?path=${encodeURIComponent(cameraId)}&start=${encodeURIComponent(startIso)}&duration=${encodeURIComponent(durationSeconds)}`;
  return format ? `${base}&format=${format}` : base;
}

/**
 * Decides what to actually request from the Playback server for a clicked
 * moment within a segment: if the segment is already shorter than the
 * requested window, just play it whole (no point fragmenting a short
 * file, and it avoids requesting more than actually exists); otherwise,
 * start exactly at the clicked moment for `windowSeconds` (clamped to the
 * segment's own end).
 */
export function resolvePlaybackWindow(
  segment: RecordingSegment,
  moment: Date,
  windowSeconds: number = DEFAULT_CLIP_WINDOW_SECONDS
): { start: string; duration: number } {
  if (segment.duration <= windowSeconds) {
    return { start: segment.start, duration: segment.duration };
  }
  const segmentStartMs = new Date(segment.start).getTime();
  const segmentEndMs = segmentStartMs + segment.duration * 1000;
  const remainingSeconds = Math.max(1, (segmentEndMs - moment.getTime()) / 1000);
  return { start: moment.toISOString(), duration: Math.min(windowSeconds, remainingSeconds) };
}

/**
 * Computes an exportable clip range for a "cut" starting `preRollSeconds`
 * before the selected moment and lasting `durationSeconds` - clamped to
 * stay within the selected segment's own bounds, so the export never
 * requests time outside of what was actually recorded in that file (which
 * would either return nothing or bleed into an unrelated segment/gap).
 */
export function resolveExportClip(
  segment: RecordingSegment,
  moment: Date,
  preRollSeconds: number,
  durationSeconds: number
): { start: string; duration: number } {
  const segmentStartMs = new Date(segment.start).getTime();
  const segmentEndMs = segmentStartMs + segment.duration * 1000;
  const rawStartMs = moment.getTime() - Math.max(0, preRollSeconds) * 1000;
  const startMs = Math.min(Math.max(segmentStartMs, rawStartMs), segmentEndMs);
  const maxDuration = Math.max(1, (segmentEndMs - startMs) / 1000);
  return { start: new Date(startMs).toISOString(), duration: Math.min(Math.max(1, durationSeconds), maxDuration) };
}
