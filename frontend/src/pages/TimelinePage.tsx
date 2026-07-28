import { useMemo, useState } from "react";
import { useCameras } from "../api/cameras";
import { useRecordings, type RecordingSegment } from "../api/recordings";
import { useEvents } from "../api/events";
import type { CameraEvent } from "../api/types";
import { RecordingPlayer } from "../components/player/RecordingPlayer";
import { RecordingTimeline } from "../components/timeline/RecordingTimeline";
import { useToastStore } from "../store/toastStore";

function todayDateInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

export function TimelinePage() {
  const { data: cameras } = useCameras();
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [date, setDate] = useState<string>(todayDateInputValue());
  const [selectedSegment, setSelectedSegment] = useState<RecordingSegment | null>(null);

  const dayStart = useMemo(() => new Date(`${date}T00:00:00`), [date]);
  const dayEnd = useMemo(() => new Date(`${date}T23:59:59.999`), [date]);

  const { data: segments, isLoading } = useRecordings(
    selectedCameraId,
    dayStart.toISOString(),
    dayEnd.toISOString(),
    Boolean(selectedCameraId)
  );

  const { data: events } = useEvents(
    { cameraId: selectedCameraId, from: dayStart.toISOString(), to: dayEnd.toISOString() },
    Boolean(selectedCameraId)
  );

  const addToast = useToastStore((s) => s.addToast);

  const handleSelectEvent = (event: CameraEvent) => {
    const eventMs = new Date(event.occurred_at).getTime();
    const match = (segments ?? []).find((segment) => {
      const startMs = new Date(segment.start).getTime();
      return eventMs >= startMs && eventMs <= startMs + segment.duration * 1000;
    });
    if (match) {
      setSelectedSegment(match);
    } else {
      addToast("info", "Nenhuma gravação encontrada para esse horário.");
    }
  };

  const handleSelectCamera = (id: string) => {
    setSelectedCameraId(id);
    setSelectedSegment(null);
  };

  const handleSelectDate = (value: string) => {
    setDate(value);
    setSelectedSegment(null);
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <label className="text-sm text-neutral-400" htmlFor="camera-select">
          Câmera
        </label>
        <select
          id="camera-select"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
          value={selectedCameraId}
          onChange={(e) => handleSelectCamera(e.target.value)}
        >
          <option value="">Selecione...</option>
          {cameras?.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.name}
            </option>
          ))}
        </select>

        <label className="text-sm text-neutral-400" htmlFor="date-select">
          Dia
        </label>
        <input
          id="date-select"
          type="date"
          value={date}
          onChange={(e) => handleSelectDate(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="min-h-0 flex-1">
        <RecordingPlayer src={selectedSegment?.url ?? null} className="h-full w-full rounded-lg" />
      </div>

      <div className="shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        {!selectedCameraId ? (
          <p className="text-sm text-neutral-500">Selecione uma câmera para ver as gravações.</p>
        ) : isLoading ? (
          <p className="text-sm text-neutral-500">Carregando gravações...</p>
        ) : (
          <RecordingTimeline
            segments={segments ?? []}
            events={events ?? []}
            dayStart={dayStart}
            selectedStart={selectedSegment?.start ?? null}
            onSelect={setSelectedSegment}
            onSelectEvent={handleSelectEvent}
          />
        )}
      </div>
    </div>
  );
}
