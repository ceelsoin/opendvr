import { useRecordings, type RecordingSegment } from "../../api/recordings";
import { useEvents } from "../../api/events";

/**
 * Fetches a single camera's recorded segments + events for a day - shared
 * by both the players grid and the stacked timelines section (see
 * LanePlayerCard/LaneTimelineRow, and the fuller `useLaneRecordings` which
 * composes this). React Query dedupes identical queries by key, so calling
 * this from two different components for the same camera+day doesn't
 * double the network requests.
 */
export function useCameraRecordings(cameraId: string, dayStart: Date, dayEnd: Date) {
  const { data: segments, isLoading } = useRecordings(cameraId, dayStart.toISOString(), dayEnd.toISOString(), Boolean(cameraId));
  const { data: events } = useEvents(
    { cameraId, from: dayStart.toISOString(), to: dayEnd.toISOString() },
    Boolean(cameraId)
  );

  return {
    segments: (segments ?? []) as RecordingSegment[],
    events: events ?? [],
    isLoading,
  };
}
