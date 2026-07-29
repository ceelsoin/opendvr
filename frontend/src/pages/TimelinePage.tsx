import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCameras } from "../api/cameras";
import {
  useRecordings,
  buildRecordingClipUrl,
  resolveExportClip,
  resolvePlaybackWindow,
  type RecordingSegment,
} from "../api/recordings";
import { useEvents } from "../api/events";
import type { CameraEvent } from "../api/types";
import { RecordingPlayer } from "../components/player/RecordingPlayer";
import { RecordingTimeline } from "../components/timeline/RecordingTimeline";
import { useToastStore } from "../store/toastStore";

const WINDOW_OPTIONS = [
  { seconds: 30, label: "30s" },
  { seconds: 60, label: "1min" },
  { seconds: 120, label: "2min" },
  { seconds: 300, label: "5min" },
];

function todayDateInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

export function TimelinePage() {
  const { data: cameras } = useCameras();
  const [searchParams] = useSearchParams();
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [date, setDate] = useState<string>(todayDateInputValue());

  // Deep-link support (e.g. from a notification's "assistir gravação"
  // link, see events/cameraEvents.ts's recordingLink) - auto-selects the
  // camera named in ?camera=<id> once the camera list has loaded, if it's
  // a valid id and nothing else was already selected by hand.
  useEffect(() => {
    const cameraIdParam = searchParams.get("camera");
    if (!cameraIdParam || selectedCameraId) return;
    if (cameras?.some((c) => c.id === cameraIdParam)) {
      setSelectedCameraId(cameraIdParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, searchParams]);
  const [selection, setSelection] = useState<{ moment: Date; segment: RecordingSegment } | null>(null);
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [exportPreRollSeconds, setExportPreRollSeconds] = useState(0);
  const [exportDurationSeconds, setExportDurationSeconds] = useState(30);
  // Set by dragging directly on the timeline (see RecordingTimeline's
  // onSelectRange) - takes priority over the pre-roll/duration inputs above
  // while set; cleared whenever those inputs are edited by hand, or a new
  // plain click/event selection is made, so "whichever was done most
  // recently" always wins.
  const [draggedRange, setDraggedRange] = useState<{ startMs: number; endMs: number; segment: RecordingSegment } | null>(
    null
  );

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

  // Decides, per click, whether to serve the whole file (already shorter
  // than the selected window) or just the exact moment onward within a
  // large file - see resolvePlaybackWindow's docstring.
  const playback = useMemo(() => {
    if (!selection) return null;
    return resolvePlaybackWindow(selection.segment, selection.moment, windowSeconds);
  }, [selection, windowSeconds]);

  const playerUrl = useMemo(() => {
    if (!playback || !selectedCameraId) return null;
    return buildRecordingClipUrl(selectedCameraId, playback.start, playback.duration);
  }, [playback, selectedCameraId]);

  // Export: either the range dragged directly on the timeline (clamped to
  // its segment's bounds), or - when no drag range is active - the
  // manually adjustable "cut" (pre-roll + duration) relative to the last
  // clicked moment. Downloaded as a standard MP4.
  const exportClip = useMemo(() => {
    if (draggedRange) {
      const segmentStartMs = new Date(draggedRange.segment.start).getTime();
      const segmentEndMs = segmentStartMs + draggedRange.segment.duration * 1000;
      const startMs = Math.max(segmentStartMs, draggedRange.startMs);
      const endMs = Math.min(segmentEndMs, draggedRange.endMs);
      return { start: new Date(startMs).toISOString(), duration: Math.max(1, (endMs - startMs) / 1000) };
    }
    if (!selection) return null;
    return resolveExportClip(selection.segment, selection.moment, exportPreRollSeconds, exportDurationSeconds);
  }, [draggedRange, selection, exportPreRollSeconds, exportDurationSeconds]);

  const exportRangeMs = useMemo(() => {
    if (!exportClip) return null;
    const startMs = new Date(exportClip.start).getTime();
    return { startMs, endMs: startMs + exportClip.duration * 1000 };
  }, [exportClip]);

  const exportUrl = useMemo(() => {
    if (!exportClip || !selectedCameraId) return null;
    return buildRecordingClipUrl(selectedCameraId, exportClip.start, exportClip.duration, "mp4");
  }, [exportClip, selectedCameraId]);

  const exportFilename = useMemo(() => {
    if (!exportClip) return "clip.mp4";
    const cameraName = cameras?.find((c) => c.id === selectedCameraId)?.name ?? "camera";
    const safeName = cameraName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const stamp = exportClip.start.replace(/[:.]/g, "-");
    return `${safeName}_${stamp}.mp4`;
  }, [exportClip, cameras, selectedCameraId]);

  const handleSelectMoment = (moment: Date, segment: RecordingSegment) => {
    setSelection({ moment, segment });
    setDraggedRange(null);
  };

  const handleSelectRange = (start: Date, end: Date, segment: RecordingSegment) => {
    setDraggedRange({ startMs: start.getTime(), endMs: end.getTime(), segment });
    // Keep the preview in sync with the start of what's about to be exported.
    setSelection({ moment: start, segment });
  };

  const handleSelectGap = () => {
    addToast("info", "Nenhuma gravação nesse momento.");
  };

  const handleSelectEvent = (event: CameraEvent) => {
    const eventMs = new Date(event.occurred_at).getTime();
    const match = (segments ?? []).find((segment) => {
      const startMs = new Date(segment.start).getTime();
      return eventMs >= startMs && eventMs <= startMs + segment.duration * 1000;
    });
    if (match) {
      setSelection({ moment: new Date(eventMs), segment: match });
      setDraggedRange(null);
    } else {
      addToast("info", "Nenhuma gravação encontrada para esse horário.");
    }
  };

  const handleSelectCamera = (id: string) => {
    setSelectedCameraId(id);
    setSelection(null);
    setDraggedRange(null);
  };

  const handleSelectDate = (value: string) => {
    setDate(value);
    setSelection(null);
    setDraggedRange(null);
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

        <label className="text-sm text-neutral-400" htmlFor="window-select">
          Janela
        </label>
        <select
          id="window-select"
          title="Duração do trecho reproduzido a partir do ponto clicado, dentro de arquivos grandes"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
          value={windowSeconds}
          onChange={(e) => setWindowSeconds(Number(e.target.value))}
        >
          {WINDOW_OPTIONS.map((opt) => (
            <option key={opt.seconds} value={opt.seconds}>
              {opt.label}
            </option>
          ))}
        </select>

        {selection && (
          <span className="text-xs text-neutral-500">
            Reproduzindo a partir de {selection.moment.toLocaleTimeString()}
            {playback && playback.start === selection.segment.start && playback.duration === selection.segment.duration
              ? " (arquivo completo)"
              : ""}
          </span>
        )}
      </div>

      {selection && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs">
          <span className="text-neutral-500">Exportar recorte:</span>
          <label className="flex items-center gap-1.5 text-neutral-400">
            começar
            <input
              type="number"
              min={0}
              step={1}
              value={exportPreRollSeconds}
              onChange={(e) => {
                setExportPreRollSeconds(Math.max(0, Number(e.target.value) || 0));
                setDraggedRange(null);
              }}
              className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
            s antes
          </label>
          <label className="flex items-center gap-1.5 text-neutral-400">
            duração
            <input
              type="number"
              min={1}
              step={1}
              value={exportDurationSeconds}
              onChange={(e) => {
                setExportDurationSeconds(Math.max(1, Number(e.target.value) || 1));
                setDraggedRange(null);
              }}
              className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
            s
          </label>
          <span className="text-neutral-600">
            {draggedRange ? "(trecho arrastado na linha do tempo)" : "(ajuste manual)"}
          </span>
          {exportClip && (
            <span className="text-neutral-600">
              ({new Date(exportClip.start).toLocaleTimeString()}, {Math.round(exportClip.duration)}s reais)
            </span>
          )}
          {exportUrl && (
            <a
              href={exportUrl}
              download={exportFilename}
              className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500"
            >
              Baixar clipe (.mp4)
            </a>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <RecordingPlayer src={playerUrl} className="h-full w-full rounded-lg" />
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
            selectedMomentMs={selection ? selection.moment.getTime() : null}
            selectedRangeMs={exportRangeMs}
            onSelectMoment={handleSelectMoment}
            onSelectRange={handleSelectRange}
            onSelectEvent={handleSelectEvent}
            onSelectGap={handleSelectGap}
          />
        )}
      </div>
    </div>
  );
}
