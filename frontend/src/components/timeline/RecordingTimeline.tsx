import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { findSegmentAtMoment, type RecordingSegment } from "../../api/recordings";
import type { CameraEvent } from "../../api/types";
import { friendlyEventType } from "../../lib/eventLabels";

interface RecordingTimelineProps {
  segments: RecordingSegment[];
  events?: CameraEvent[];
  dayStart: Date;
  /** Timestamp (ms) of the currently selected moment, for the marker line - null if nothing is selected. */
  selectedMomentMs: number | null;
  /** Currently exportable range (ms), rendered as a translucent band - null if none. */
  selectedRangeMs?: { startMs: number; endMs: number } | null;
  /**
   * Called on a plain click (not a drag) anywhere on the bar, with the
   * segment covering that moment for THIS timeline (or null if it falls in
   * a gap) - used both for preview playback and to keep multiple
   * timelines (one per camera, see LanePlayerCard/LaneTimelineRow) in sync on the same
   * wall-clock moment even when a given camera has no recording there.
   */
  onSelectMoment: (moment: Date, segment: RecordingSegment | null) => void;
  /** Called after dragging across the bar, with the segment covering the drag's start point for THIS timeline (or null if it falls in a gap). */
  onSelectRange?: (start: Date, end: Date, segment: RecordingSegment | null) => void;
  onSelectEvent?: (event: CameraEvent) => void;
  /** Hides the hour-of-day ruler row - used when several timelines are stacked, so only the bottom-most one shows it (they all share the same day/axis). Defaults to true. */
  showHourMarks?: boolean;
  /** Hides the usage hint paragraph below the bar - same rationale as `showHourMarks`. Defaults to true. */
  showHint?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
/** Minimum pixel movement before a press+release counts as a drag (range select) instead of a plain click (moment select). */
const DRAG_THRESHOLD_PX = 4;

/**
 * Horizontal 24h timeline: recorded segments are rendered as blocks
 * positioned/sized proportionally to their time-of-day, similar to
 * Agent DVR/iSpy's recording timeline. Unlike a plain "click a block to
 * select the whole file" control, interaction is handled at the bar level
 * (not per-segment) so the exact pixel position - even inside a single
 * large file spanning hours - maps to an exact clock time:
 * - A plain click selects a moment for preview playback (see
 *   `resolvePlaybackWindow` in api/recordings.ts).
 * - Click-and-drag selects a precise start/end range for export (see
 *   `onSelectRange` / TimelinePage's export panel), rendered as a
 *   translucent band while dragging and once committed.
 * This is a UI-level fragmentation of the *selector*, since the underlying
 * recording itself usually can't be split on demand (MediaMTX's
 * `recordSegmentDuration` is only a minimum - see docs/troubleshooting.md).
 */
export function RecordingTimeline({
  segments,
  events = [],
  dayStart,
  selectedMomentMs,
  selectedRangeMs,
  onSelectMoment,
  onSelectRange,
  onSelectEvent,
  showHourMarks = true,
  showHint = true,
}: RecordingTimelineProps) {
  const { t, i18n } = useTranslation();
  const dayStartMs = dayStart.getTime();
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const [liveDrag, setLiveDrag] = useState<{ startFraction: number; currentFraction: number } | null>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const xToFraction = (clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartXRef.current = e.clientX;
    const fraction = xToFraction(e.clientX);
    setLiveDrag({ startFraction: fraction, currentFraction: fraction });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const fraction = xToFraction(e.clientX);
    setHoverFraction(fraction);
    if (dragStartXRef.current === null) return;
    setLiveDrag((prev) => (prev ? { ...prev, currentFraction: fraction } : prev));
  };

  const handlePointerLeave = () => {
    setHoverFraction(null);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startX = dragStartXRef.current;
    dragStartXRef.current = null;
    setLiveDrag(null);
    if (startX === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const startMomentMs = dayStartMs + xToFraction(startX) * DAY_MS;
    const isDrag = Math.abs(e.clientX - startX) >= DRAG_THRESHOLD_PX;

    if (!isDrag) {
      onSelectMoment(new Date(startMomentMs), findSegmentAtMoment(segments, startMomentMs) ?? null);
      return;
    }

    const endMomentMs = dayStartMs + xToFraction(e.clientX) * DAY_MS;
    const rangeStartMs = Math.min(startMomentMs, endMomentMs);
    const rangeEndMs = Math.max(startMomentMs, endMomentMs);
    onSelectRange?.(new Date(rangeStartMs), new Date(rangeEndMs), findSegmentAtMoment(segments, rangeStartMs) ?? null);
  };

  const pctFor = (momentMs: number) => Math.min(100, Math.max(0, ((momentMs - dayStartMs) / DAY_MS) * 100));

  const selectedLeftPct =
    selectedMomentMs !== null && selectedMomentMs >= dayStartMs && selectedMomentMs <= dayStartMs + DAY_MS
      ? pctFor(selectedMomentMs)
      : null;

  return (
    <div className="flex flex-col gap-1">
      {events.length > 0 && (
        <div className="relative h-4 w-full">
          {events.map((event) => {
            const eventMs = new Date(event.occurred_at).getTime();
            const leftPct = Math.min(100, Math.max(0, ((eventMs - dayStartMs) / DAY_MS) * 100));
            return (
              <button
                key={event.id}
                type="button"
                title={t("timeline.eventTitle", { type: friendlyEventType(event.type, t), time: new Date(event.occurred_at).toLocaleTimeString(i18n.language) })}
                onClick={() => onSelectEvent?.(event)}
                style={{ left: `${leftPct}%` }}
                className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full border border-neutral-950 bg-amber-400 hover:bg-amber-300"
              />
            );
          })}
        </div>
      )}
      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className="relative h-14 w-full touch-none cursor-crosshair overflow-hidden rounded-md border border-neutral-800 bg-neutral-950"
      >
        {segments.map((segment) => {
          const segmentStartMs = new Date(segment.start).getTime();
          const offsetMs = segmentStartMs - dayStartMs;
          const leftPct = Math.max(0, (offsetMs / DAY_MS) * 100);
          const widthPct = Math.max(0.3, (segment.duration * 1000 / DAY_MS) * 100);
          const isSelected =
            selectedMomentMs !== null &&
            selectedMomentMs >= segmentStartMs &&
            selectedMomentMs <= segmentStartMs + segment.duration * 1000;

          return (
            <div
              key={segment.start}
              title={t("timeline.segmentTitle", { time: new Date(segment.start).toLocaleTimeString(i18n.language), duration: Math.round(segment.duration) })}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              className={`absolute top-0 h-full transition-colors ${
                isSelected ? "bg-blue-700 hover:bg-blue-600" : "bg-green-700 hover:bg-green-600"
              }`}
            />
          );
        })}
        {selectedRangeMs && (
          <div
            title={t("timeline.selectedRangeTitle")}
            style={{
              left: `${pctFor(selectedRangeMs.startMs)}%`,
              width: `${Math.max(0.2, pctFor(selectedRangeMs.endMs) - pctFor(selectedRangeMs.startMs))}%`,
            }}
            className="pointer-events-none absolute top-0 h-full border-x-2 border-amber-300 bg-amber-300/25"
          />
        )}
        {liveDrag && (
          <div
            style={{
              left: `${Math.min(liveDrag.startFraction, liveDrag.currentFraction) * 100}%`,
              width: `${Math.max(0.2, Math.abs(liveDrag.currentFraction - liveDrag.startFraction) * 100)}%`,
            }}
            className="pointer-events-none absolute top-0 h-full bg-amber-300/40"
          />
        )}
        {selectedLeftPct !== null && (
          <div
            title={t("timeline.selectedMomentTitle")}
            style={{ left: `${selectedLeftPct}%` }}
            className="pointer-events-none absolute top-0 h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)]"
          />
        )}
        {segments.length === 0 && (
          <div className="pointer-events-none flex h-full items-center justify-center text-xs text-neutral-600">
            {t("timeline.noRecordingsToday")}
          </div>
        )}
        {hoverFraction !== null && (
          <div
            style={{ left: `${Math.min(97, Math.max(3, hoverFraction * 100))}%` }}
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-900 shadow"
          >
            {new Date(dayStartMs + hoverFraction * DAY_MS).toLocaleTimeString(i18n.language)}
          </div>
        )}
      </div>
      <div className="relative h-4 text-[10px] text-neutral-500">
        {showHourMarks &&
          HOUR_MARKS.map((hour) => (
            <span key={hour} className="absolute -translate-x-1/2" style={{ left: `${(hour / 24) * 100}%` }}>
              {String(hour).padStart(2, "0")}h
            </span>
          ))}
      </div>
      {showHint && (
        <p className="text-[11px] text-neutral-600">
          {t("timeline.footerHint")}
        </p>
      )}
    </div>
  );
}

