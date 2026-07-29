import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildRecordingClipUrl, findNextPlaybackMoment } from "../../api/recordings";
import type { Camera } from "../../api/types";
import { RecordingPlayer } from "../player/RecordingPlayer";
import { useLaneRecordings } from "./useLaneRecordings";

export interface LaneExportClip {
  url: string;
  filename: string;
}

interface LanePlayerCardProps {
  cameraId: string;
  /** Cameras selectable for this lane's own picker - this camera plus whichever ones no other lane is currently showing. */
  cameraOptions: Camera[];
  dayStart: Date;
  dayEnd: Date;
  windowSeconds: number;
  exportPreRollSeconds: number;
  exportDurationSeconds: number;
  selectionMomentMs: number | null;
  selectionRangeMs: { startMs: number; endMs: number } | null;
  onChangeCamera: (cameraId: string) => void;
  onRemove: () => void;
  removable: boolean;
  onExportClipChange: (clip: LaneExportClip | null) => void;
  /** Reports this camera's live playback position (ms) up to TimelinePage, so the matching timeline row's marker moves in step with what's actually playing (see LaneTimelineRow). */
  onPlayHeadProgress: (momentMs: number | null) => void;
}

/**
 * One tile in the players grid (see TimelinePage): camera picker + remove
 * button + video preview. Rendered side-by-side with the other cameras'
 * tiles, while each camera's own timeline bar lives separately, stacked
 * below (see LaneTimelineRow) - both read the same underlying segments via
 * `useLaneRecordings`/`useCameraRecordings`, which React Query dedupes so
 * it's not fetched twice.
 *
 * Once a moment is selected, this owns a local, auto-advancing "play head"
 * independent of that original selection: when a clip ends, `onEnded`
 * looks for wherever recording continues next (same segment's remainder,
 * the next segment, or across a gap - see `findNextPlaybackMoment`) and
 * keeps going, so picking one instant plays continuously through the rest
 * of the day's recordings instead of stopping after one clip.
 */
export function LanePlayerCard({
  cameraId,
  cameraOptions,
  dayStart,
  dayEnd,
  windowSeconds,
  exportPreRollSeconds,
  exportDurationSeconds,
  selectionMomentMs,
  selectionRangeMs,
  onChangeCamera,
  onRemove,
  removable,
  onExportClipChange,
  onPlayHeadProgress,
}: LanePlayerCardProps) {
  const { t, i18n } = useTranslation();
  const camera = cameraOptions.find((c) => c.id === cameraId);

  const [playHeadMs, setPlayHeadMs] = useState<number | null>(selectionMomentMs);
  const [liveProgressMs, setLiveProgressMs] = useState<number | null>(selectionMomentMs);
  const [reachedEnd, setReachedEnd] = useState(false);

  // A fresh click/drag on any camera's timeline re-seeds every lane's play
  // head to that same instant, snapping the marker immediately (rather
  // than waiting for the new clip's first `timeupdate`) and restarting
  // continuous playback from there.
  useEffect(() => {
    setPlayHeadMs(selectionMomentMs);
    setLiveProgressMs(selectionMomentMs);
    setReachedEnd(false);
    onPlayHeadProgress(selectionMomentMs);
    // onPlayHeadProgress is a stable callback identity from the parent (bound by lane index).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionMomentMs, selectionRangeMs]);

  const { segments, playerUrl, ownSegment, playback, exportClip } = useLaneRecordings({
    cameraId,
    dayStart,
    dayEnd,
    windowSeconds,
    exportPreRollSeconds,
    exportDurationSeconds,
    playbackMomentMs: playHeadMs,
    exportMomentMs: selectionMomentMs,
    exportRangeMs: selectionRangeMs,
  });

  useEffect(() => {
    if (!exportClip || !cameraId) {
      onExportClipChange(null);
      return;
    }
    const safeName = (camera?.name ?? cameraId).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const stamp = exportClip.start.replace(/[:.]/g, "-");
    onExportClipChange({
      url: buildRecordingClipUrl(cameraId, exportClip.start, exportClip.duration, "mp4"),
      filename: `${safeName}_${stamp}.mp4`,
    });
    // onExportClipChange is a stable callback identity from the parent (bound by lane index).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportClip, cameraId, camera?.name]);

  const handleTimeUpdate = (currentTimeSeconds: number) => {
    if (!playback) return;
    const progressMs = new Date(playback.start).getTime() + currentTimeSeconds * 1000;
    setLiveProgressMs(progressMs);
    onPlayHeadProgress(progressMs);
  };

  const handleEnded = () => {
    if (!playback) return;
    const finishedAtMs = new Date(playback.start).getTime() + playback.duration * 1000;
    const next = findNextPlaybackMoment(segments, finishedAtMs);
    if (next === null) {
      setReachedEnd(true);
      return;
    }
    setPlayHeadMs(next);
  };

  const isFullFile = Boolean(ownSegment) && playback?.start === ownSegment?.start && playback?.duration === ownSegment?.duration;

  const placeholderText = reachedEnd
    ? t("timeline.endOfRecordings")
    : selectionMomentMs === null
      ? t("timeline.selectMomentHint")
      : t("timeline.noRecordingAtMoment");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center justify-between gap-2">
        <select
          value={cameraId}
          onChange={(e) => onChangeCamera(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
        >
          {cameraOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-950"
          >
            {t("timeline.removeLane")}
          </button>
        )}
      </div>

      <div className="aspect-video shrink-0">
        {playerUrl ? (
          <RecordingPlayer
            src={playerUrl}
            className="h-full w-full rounded-md"
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-md bg-black text-center text-sm text-neutral-600">
            {placeholderText}
          </div>
        )}
      </div>

      {playback && liveProgressMs !== null && (
        <span className="text-[11px] text-neutral-600">
          {t("timeline.playingFrom", { time: new Date(liveProgressMs).toLocaleTimeString(i18n.language) })}
          {isFullFile ? t("timeline.fullFileSuffix") : ""}
        </span>
      )}
    </div>
  );
}
