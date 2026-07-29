import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCameras } from "../api/cameras";
import { LanePlayerCard, type LaneExportClip } from "../components/timeline/LanePlayerCard";
import { LaneTimelineRow } from "../components/timeline/LaneTimelineRow";

const WINDOW_OPTIONS = [
  { seconds: 30, label: "30s" },
  { seconds: 60, label: "1min" },
  { seconds: 120, label: "2min" },
  { seconds: 300, label: "5min" },
];

/** Remembers the last camera viewed on the primary (first) lane, so returning to this page defaults to it instead of always starting empty. */
const LAST_CAMERA_STORAGE_KEY = "opendvr.timeline.lastCameraId";
/** Minimum delay between each staggered download in "download all" - avoids browsers blocking/bunching several near-simultaneous downloads. */
const DOWNLOAD_STAGGER_MS = 400;

function todayDateInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Multi-camera recording review: always starts with one camera (the last
 * one viewed, or `?camera=<id>` from a deep link), and lets the user add
 * more as extra tiles to compare in parallel. Players are laid out
 * side-by-side in a grid (see LanePlayerCard), while each camera's own 24h
 * timeline is stacked vertically below with its name as a legend (see
 * LaneTimelineRow) - both sides are driven by one shared pointer, so
 * scrubbing/dragging on any camera's timeline moves every camera's preview
 * to the same wall-clock moment/range. "Download recordings" exports the
 * shared selected range from every added camera at once.
 */
export function TimelinePage() {
  const { t } = useTranslation();
  const { data: cameras } = useCameras();
  const [searchParams] = useSearchParams();

  const [cameraIds, setCameraIds] = useState<string[]>([]);
  const [exportClips, setExportClips] = useState<(LaneExportClip | null)[]>([]);
  const [playHeadsMs, setPlayHeadsMs] = useState<(number | null)[]>([]);
  const [date, setDate] = useState<string>(todayDateInputValue());
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [exportPreRollSeconds, setExportPreRollSeconds] = useState(0);
  const [exportDurationSeconds, setExportDurationSeconds] = useState(30);
  const [selectionMomentMs, setSelectionMomentMs] = useState<number | null>(null);
  const [selectionRangeMs, setSelectionRangeMs] = useState<{ startMs: number; endMs: number } | null>(null);

  // Starts with exactly one lane: the camera named in ?camera=<id> (deep
  // link from a notification, see events/cameraEvents.ts's recordingLink),
  // else the last camera viewed here (localStorage), else just the first
  // registered camera. Runs once, as soon as the camera list has loaded.
  useEffect(() => {
    if (cameraIds.length > 0 || !cameras || cameras.length === 0) return;
    const paramId = searchParams.get("camera");
    const stored = localStorage.getItem(LAST_CAMERA_STORAGE_KEY);
    const initial =
      (paramId && cameras.some((c) => c.id === paramId) && paramId) ||
      (stored && cameras.some((c) => c.id === stored) && stored) ||
      cameras[0].id;
    setCameraIds([initial]);
    setExportClips([null]);
    setPlayHeadsMs([null]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, searchParams, cameraIds.length]);

  // Remembers whichever camera is on the primary (first) lane for next visit.
  useEffect(() => {
    if (cameraIds[0]) localStorage.setItem(LAST_CAMERA_STORAGE_KEY, cameraIds[0]);
  }, [cameraIds]);

  const dayStart = useMemo(() => new Date(`${date}T00:00:00`), [date]);
  const dayEnd = useMemo(() => new Date(`${date}T23:59:59.999`), [date]);

  const handleSelectDate = (value: string) => {
    setDate(value);
    setSelectionMomentMs(null);
    setSelectionRangeMs(null);
  };

  const handleSelectMoment = (momentMs: number) => {
    setSelectionMomentMs(momentMs);
    setSelectionRangeMs(null);
  };

  const handleSelectRange = (startMs: number, endMs: number) => {
    setSelectionRangeMs({ startMs, endMs });
    setSelectionMomentMs(startMs);
  };

  const handleChangeLaneCamera = (index: number, newCameraId: string) => {
    setCameraIds((prev) => prev.map((id, i) => (i === index ? newCameraId : id)));
  };

  const handleAddCamera = (newCameraId: string) => {
    if (!newCameraId) return;
    setCameraIds((prev) => [...prev, newCameraId]);
    setExportClips((prev) => [...prev, null]);
    setPlayHeadsMs((prev) => [...prev, null]);
  };

  const handleRemoveLane = (index: number) => {
    setCameraIds((prev) => prev.filter((_, i) => i !== index));
    setExportClips((prev) => prev.filter((_, i) => i !== index));
    setPlayHeadsMs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLaneExportClipChange = (index: number, clip: LaneExportClip | null) => {
    setExportClips((prev) => {
      if (prev[index] === clip) return prev;
      const next = [...prev];
      next[index] = clip;
      return next;
    });
  };

  const handleLanePlayHeadProgress = (index: number, momentMs: number | null) => {
    setPlayHeadsMs((prev) => {
      if (prev[index] === momentMs) return prev;
      const next = [...prev];
      next[index] = momentMs;
      return next;
    });
  };

  const handleDownloadAll = () => {
    exportClips.forEach((clip, index) => {
      if (!clip) return;
      window.setTimeout(() => {
        const a = document.createElement("a");
        a.href = clip.url;
        a.download = clip.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, index * DOWNLOAD_STAGGER_MS);
    });
  };

  const downloadableCount = exportClips.filter(Boolean).length;
  const unusedCameras = cameras?.filter((c) => !cameraIds.includes(c.id)) ?? [];

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <label className="text-sm text-neutral-400" htmlFor="date-select">
          {t("timeline.dayLabel")}
        </label>
        <input
          id="date-select"
          type="date"
          value={date}
          onChange={(e) => handleSelectDate(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
        />

        <label className="text-sm text-neutral-400" htmlFor="window-select">
          {t("timeline.windowLabel")}
        </label>
        <select
          id="window-select"
          title={t("timeline.windowTitle")}
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

        {unusedCameras.length > 0 && (
          <select
            key={cameraIds.length}
            defaultValue=""
            onChange={(e) => handleAddCamera(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
          >
            <option value="" disabled>
              {t("timeline.addCamera")}
            </option>
            {unusedCameras.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectionMomentMs !== null && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs">
          <span className="text-neutral-500">{t("timeline.exportLabel")}</span>
          <label className="flex items-center gap-1.5 text-neutral-400">
            {t("timeline.startBefore")}
            <input
              type="number"
              min={0}
              step={1}
              value={exportPreRollSeconds}
              onChange={(e) => {
                setExportPreRollSeconds(Math.max(0, Number(e.target.value) || 0));
                setSelectionRangeMs(null);
              }}
              className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
            {t("timeline.secondsBefore")}
          </label>
          <label className="flex items-center gap-1.5 text-neutral-400">
            {t("timeline.duration")}
            <input
              type="number"
              min={1}
              step={1}
              value={exportDurationSeconds}
              onChange={(e) => {
                setExportDurationSeconds(Math.max(1, Number(e.target.value) || 1));
                setSelectionRangeMs(null);
              }}
              className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
            {t("timeline.seconds")}
          </label>
          <span className="text-neutral-600">
            {selectionRangeMs ? t("timeline.draggedRangeNote") : t("timeline.manualAdjustNote")}
          </span>
          <button
            type="button"
            onClick={handleDownloadAll}
            disabled={downloadableCount === 0}
            className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("timeline.downloadAll", { count: downloadableCount })}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cameraIds.map((cameraId, index) => {
          const cameraOptions = cameras?.filter((c) => c.id === cameraId || !cameraIds.includes(c.id)) ?? [];
          return (
            <LanePlayerCard
              key={index}
              cameraId={cameraId}
              cameraOptions={cameraOptions}
              dayStart={dayStart}
              dayEnd={dayEnd}
              windowSeconds={windowSeconds}
              exportPreRollSeconds={exportPreRollSeconds}
              exportDurationSeconds={exportDurationSeconds}
              selectionMomentMs={selectionMomentMs}
              selectionRangeMs={selectionRangeMs}
              onChangeCamera={(newId) => handleChangeLaneCamera(index, newId)}
              onRemove={() => handleRemoveLane(index)}
              removable={cameraIds.length > 1}
              onExportClipChange={(clip) => handleLaneExportClipChange(index, clip)}
              onPlayHeadProgress={(ms) => handleLanePlayHeadProgress(index, ms)}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        {cameraIds.map((cameraId, index) => (
          <LaneTimelineRow
            key={index}
            cameraId={cameraId}
            cameraName={cameras?.find((c) => c.id === cameraId)?.name ?? cameraId}
            dayStart={dayStart}
            dayEnd={dayEnd}
            markerMomentMs={playHeadsMs[index] ?? selectionMomentMs}
            selectionRangeMs={selectionRangeMs}
            onSelectMoment={handleSelectMoment}
            onSelectRange={handleSelectRange}
            isLast={index === cameraIds.length - 1}
            isLoadingLabel={t("timeline.loadingRecordings")}
          />
        ))}
      </div>
    </div>
  );
}
