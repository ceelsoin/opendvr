import type { CameraEvent } from "../../api/types";
import { useCameraRecordings } from "./useCameraRecordings";
import { RecordingTimeline } from "./RecordingTimeline";

interface LaneTimelineRowProps {
  cameraId: string;
  cameraName: string;
  dayStart: Date;
  dayEnd: Date;
  /** Marker position (ms) for this camera - the live playback progress once playing (see LanePlayerCard), falling back to the plain clicked moment before that. */
  markerMomentMs: number | null;
  /** Stable, user-dragged export range (ms), rendered identically across every camera's row so the window stays visually comparable. */
  selectionRangeMs: { startMs: number; endMs: number } | null;
  onSelectMoment: (momentMs: number) => void;
  onSelectRange: (startMs: number, endMs: number) => void;
  /** Only the bottom-most row in the stack shows the hour ruler/usage hint, since every row shares the exact same day/axis. */
  isLast: boolean;
  isLoadingLabel: string;
}

/**
 * One row in the stacked timelines section (see TimelinePage): the camera's
 * name as a legend, followed by its own 24h recording bar. Several of
 * these are stacked vertically (one per added camera) directly above one
 * another so they line up like tracks in a multi-camera NVR timeline,
 * while the actual video previews live separately, side-by-side in the
 * players grid (see LanePlayerCard) - both pull the same underlying data
 * via `useCameraRecordings`.
 */
export function LaneTimelineRow({
  cameraId,
  cameraName,
  dayStart,
  dayEnd,
  markerMomentMs,
  selectionRangeMs,
  onSelectMoment,
  onSelectRange,
  isLast,
  isLoadingLabel,
}: LaneTimelineRowProps) {
  const { segments, events, isLoading } = useCameraRecordings(cameraId, dayStart, dayEnd);

  const handleSelectMoment = (moment: Date) => onSelectMoment(moment.getTime());
  const handleSelectRange = (start: Date, end: Date) => onSelectRange(start.getTime(), end.getTime());
  const handleSelectEvent = (event: CameraEvent) => onSelectMoment(new Date(event.occurred_at).getTime());

  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 truncate pt-4 text-xs font-medium text-neutral-300" title={cameraName}>
        {cameraName}
      </span>
      <div className="min-w-0 flex-1">
        {isLoading ? (
          <p className="text-xs text-neutral-500">{isLoadingLabel}</p>
        ) : (
          <RecordingTimeline
            segments={segments}
            events={events}
            dayStart={dayStart}
            selectedMomentMs={markerMomentMs}
            selectedRangeMs={selectionRangeMs}
            onSelectMoment={handleSelectMoment}
            onSelectRange={handleSelectRange}
            onSelectEvent={handleSelectEvent}
            showHourMarks={isLast}
            showHint={isLast}
          />
        )}
      </div>
    </div>
  );
}
