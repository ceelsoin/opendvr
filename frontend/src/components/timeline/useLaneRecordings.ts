import { useMemo } from "react";
import {
  buildRecordingClipUrl,
  findSegmentAtMoment,
  resolveExportClip,
  resolvePlaybackWindow,
} from "../../api/recordings";
import { useCameraRecordings } from "./useCameraRecordings";

interface UseLaneRecordingsOptions {
  cameraId: string;
  dayStart: Date;
  dayEnd: Date;
  windowSeconds: number;
  exportPreRollSeconds: number;
  exportDurationSeconds: number;
  /**
   * Wall-clock moment (ms) to actually stream from - this is the lane's own
   * advancing play head (see LanePlayerCard), NOT necessarily the original
   * clicked moment: it moves forward as playback continues into
   * subsequent windows/segments, independently of the stable selection
   * below (so continuing playback doesn't change what "download
   * recordings" would export).
   */
  playbackMomentMs: number | null;
  /** Stable, user-picked moment (unaffected by playback progress) driving the exportable clip when no drag range is active. */
  exportMomentMs: number | null;
  /** Stable, user-dragged wall-clock range driving the exportable clip, when active. */
  exportRangeMs: { startMs: number; endMs: number } | null;
}

/**
 * Resolves everything a single camera's player needs: the segment/playback
 * window covering `playbackMomentMs`, and (independently) the exportable
 * clip range for "download recordings", based on the original stable
 * selection rather than wherever continuous playback has advanced to.
 * Segments/events themselves come from `useCameraRecordings`, shared with
 * the read-only stacked timeline row for the same camera.
 */
export function useLaneRecordings({
  cameraId,
  dayStart,
  dayEnd,
  windowSeconds,
  exportPreRollSeconds,
  exportDurationSeconds,
  playbackMomentMs,
  exportMomentMs,
  exportRangeMs,
}: UseLaneRecordingsOptions) {
  const { segments, events, isLoading } = useCameraRecordings(cameraId, dayStart, dayEnd);

  const ownSegment = useMemo(() => {
    if (playbackMomentMs === null) return undefined;
    return findSegmentAtMoment(segments, playbackMomentMs);
  }, [segments, playbackMomentMs]);

  const playback = useMemo(() => {
    if (!ownSegment || playbackMomentMs === null) return null;
    return resolvePlaybackWindow(ownSegment, new Date(playbackMomentMs), windowSeconds);
  }, [ownSegment, playbackMomentMs, windowSeconds]);

  const playerUrl = useMemo(() => {
    if (!playback || !cameraId) return null;
    return buildRecordingClipUrl(cameraId, playback.start, playback.duration);
  }, [playback, cameraId]);

  // Export: prefer the range dragged directly on the timeline (clamped to
  // whichever segment THIS camera has covering its start, if any),
  // otherwise the manually adjustable pre-roll/duration cut relative to the
  // stable clicked moment. Deliberately independent of `playbackMomentMs`,
  // so auto-advancing through the day's recordings doesn't move the target
  // of "download recordings".
  const exportClip = useMemo(() => {
    if (exportRangeMs) {
      const segment = findSegmentAtMoment(segments, exportRangeMs.startMs);
      if (!segment) return null;
      const segmentStartMs = new Date(segment.start).getTime();
      const segmentEndMs = segmentStartMs + segment.duration * 1000;
      const startMs = Math.max(segmentStartMs, exportRangeMs.startMs);
      const endMs = Math.min(segmentEndMs, exportRangeMs.endMs);
      if (endMs <= startMs) return null;
      return { start: new Date(startMs).toISOString(), duration: Math.max(1, (endMs - startMs) / 1000) };
    }
    const exportSegment = exportMomentMs === null ? undefined : findSegmentAtMoment(segments, exportMomentMs);
    if (exportMomentMs === null || !exportSegment) return null;
    return resolveExportClip(exportSegment, new Date(exportMomentMs), exportPreRollSeconds, exportDurationSeconds);
  }, [segments, exportRangeMs, exportMomentMs, exportPreRollSeconds, exportDurationSeconds]);

  return {
    segments,
    events,
    isLoading,
    ownSegment,
    playback,
    playerUrl,
    exportClip,
  };
}
