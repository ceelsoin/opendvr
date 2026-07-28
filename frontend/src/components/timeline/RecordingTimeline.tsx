import type { RecordingSegment } from "../../api/recordings";
import type { CameraEvent } from "../../api/types";
import { friendlyEventType } from "../../lib/eventLabels";

interface RecordingTimelineProps {
  segments: RecordingSegment[];
  events?: CameraEvent[];
  dayStart: Date;
  selectedStart: string | null;
  onSelect: (segment: RecordingSegment) => void;
  onSelectEvent?: (event: CameraEvent) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/**
 * Horizontal 24h timeline: recorded segments are rendered as blocks
 * positioned/sized proportionally to their time-of-day, similar to
 * Agent DVR/iSpy's recording timeline. Clicking a segment selects it for
 * playback (see RecordingPlayer). ONVIF motion/tamper events are overlaid
 * as small markers above the bar - clicking one jumps to the recording
 * covering that moment, if any (see TimelinePage's onSelectEvent).
 */
export function RecordingTimeline({
  segments,
  events = [],
  dayStart,
  selectedStart,
  onSelect,
  onSelectEvent,
}: RecordingTimelineProps) {
  const dayStartMs = dayStart.getTime();

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
      <div className="relative h-14 w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
        {segments.map((segment) => {
          const segmentStartMs = new Date(segment.start).getTime();
          const offsetMs = segmentStartMs - dayStartMs;
          const leftPct = Math.max(0, (offsetMs / DAY_MS) * 100);
          const widthPct = Math.max(0.3, (segment.duration * 1000 / DAY_MS) * 100);
          const isSelected = segment.start === selectedStart;

          return (
            <button
              key={segment.start}
              type="button"
              title={`${new Date(segment.start).toLocaleTimeString()} (${Math.round(segment.duration)}s)`}
              onClick={() => onSelect(segment)}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              className={`absolute top-0 h-full transition-colors ${
                isSelected ? "bg-blue-500" : "bg-green-700 hover:bg-green-600"
              }`}
            />
          );
        })}
        {segments.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-neutral-600">
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
    </div>
  );
}
