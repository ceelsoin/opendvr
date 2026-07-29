import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RecordingSegment } from "../../api/recordings";
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
  /** Called on a plain click (not a drag) on a point that falls within a recorded segment - used for preview playback. */
  onSelectMoment: (moment: Date, segment: RecordingSegment) => void;
  /** Called after dragging across the bar, resolved against the segment covering the drag's start point - used to pick an export range directly on the timeline. */
  onSelectRange?: (start: Date, end: Date, segment: RecordingSegment) => void;
  onSelectEvent?: (event: CameraEvent) => void;
  /** Called when the user clicks/drags starting from a point with no recording covering it. */
  onSelectGap?: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
/** Minimum pixel movement before a press+release counts as a drag (range select) instead of a plain click (moment select). */
const DRAG_THRESHOLD_PX = 4;

function findSegmentAt(segments: RecordingSegment[], momentMs: number): RecordingSegment | undefined {
  return segments.find((segment) => {
    const startMs = new Date(segment.start).getTime();
    return momentMs >= startMs && momentMs <= startMs + segment.duration * 1000;
  });
}

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
  onSelectGap,
}: RecordingTimelineProps) {
  const dayStartMs = dayStart.getTime();
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const [liveDrag, setLiveDrag] = useState<{ startFraction: number; currentFraction: number } | null>(null);

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
    if (dragStartXRef.current === null) return;
    setLiveDrag((prev) => (prev ? { ...prev, currentFraction: xToFraction(e.clientX) } : prev));
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
      const segment = findSegmentAt(segments, startMomentMs);
      if (segment) {
        onSelectMoment(new Date(startMomentMs), segment);
      } else {
        onSelectGap?.();
      }
      return;
    }

    const endMomentMs = dayStartMs + xToFraction(e.clientX) * DAY_MS;
    const rangeStartMs = Math.min(startMomentMs, endMomentMs);
    const rangeEndMs = Math.max(startMomentMs, endMomentMs);
    const segment = findSegmentAt(segments, rangeStartMs);
    if (segment) {
      onSelectRange?.(new Date(rangeStartMs), new Date(rangeEndMs), segment);
    } else {
      onSelectGap?.();
    }
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
                title={`${friendlyEventType(event.type)} às ${new Date(event.occurred_at).toLocaleTimeString()}`}
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
              title={`${new Date(segment.start).toLocaleTimeString()} (${Math.round(segment.duration)}s) — clique para ir direto para aquele instante, ou arraste para selecionar um trecho pra exportar`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              className={`absolute top-0 h-full transition-colors ${
                isSelected ? "bg-blue-700 hover:bg-blue-600" : "bg-green-700 hover:bg-green-600"
              }`}
            />
          );
        })}
        {selectedRangeMs && (
          <div
            title="Trecho selecionado para exportação"
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
            title="Momento selecionado"
            style={{ left: `${selectedLeftPct}%` }}
            className="pointer-events-none absolute top-0 h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)]"
          />
        )}
        {segments.length === 0 && (
          <div className="pointer-events-none flex h-full items-center justify-center text-xs text-neutral-600">
            Nenhuma gravação neste dia
          </div>
        )}
      </div>
      <div className="relative h-4 text-[10px] text-neutral-500">
        {HOUR_MARKS.map((hour) => (
          <span
            key={hour}
            className="absolute -translate-x-1/2"
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {String(hour).padStart(2, "0")}h
          </span>
        ))}
      </div>
      <p className="text-[11px] text-neutral-600">
        Clique para ir direto para um instante, ou arraste para selecionar um trecho exato (mesmo dentro de um
        arquivo de horas) e exportá-lo.
      </p>
    </div>
  );
}

