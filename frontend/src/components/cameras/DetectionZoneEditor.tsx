import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../../api/client";
import type { DetectionZone } from "../../api/types";

interface DetectionZoneEditorProps {
  cameraId: string;
  initialZone: DetectionZone | null;
  onSave: (zone: DetectionZone | null) => void;
  onClose: () => void;
}

/**
 * Item 2 (zone of interest): a minimal point-and-click polygon editor drawn
 * over a live snapshot of the camera (GET /cameras/:id/snapshot). Points are
 * stored normalized 0..1 relative to the image's natural size, so the zone
 * stays valid regardless of the actual stream resolution (see backend's
 * lib/geometry.ts). Applies to every video-based detection method (plain
 * motion detection, object detection, face recognition alike), not just
 * object detection. Deliberately simple - click to add a vertex, no drag-
 * to-reposition/curve editing - a straight polygon is enough to exclude
 * areas like a public sidewalk visible through a gate.
 */
export function DetectionZoneEditor({ cameraId, initialZone, onSave, onClose }: DetectionZoneEditorProps) {
  const { t } = useTranslation();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [points, setPoints] = useState<Array<[number, number]>>(initialZone?.points ?? []);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    apiClient
      .get(`/cameras/${cameraId}/snapshot`, { responseType: "blob" })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data as Blob);
        setImageUrl(objectUrl);
      })
      .catch(() => setImageError(true));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cameraId]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPoints((prev) => [...prev, [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]]);
  };

  const handleUndo = () => setPoints((prev) => prev.slice(0, -1));
  const handleClear = () => setPoints([]);

  const handleSave = () => {
    onSave(points.length >= 3 ? { points } : null);
    onClose();
  };

  const polygonAttr = points.map(([x, y]) => `${x * 100},${y * 100}`).join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="text-sm font-semibold">{t("detectionZone.title")}</h2>
        <p className="text-xs text-neutral-500">{t("detectionZone.hint")}</p>
        <div
          ref={containerRef}
          onClick={handleClick}
          className="relative aspect-video w-full cursor-crosshair overflow-hidden rounded-md border border-neutral-800 bg-neutral-900"
        >
          {imageUrl && (
            <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
          )}
          {!imageUrl && !imageError && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
              {t("detectionZone.loadingSnapshot")}
            </p>
          )}
          {imageError && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-amber-500">
              {t("detectionZone.snapshotFailed")}
            </p>
          )}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {points.length >= 3 && (
              <polygon points={polygonAttr} fill="rgba(59,130,246,0.25)" stroke="rgb(59,130,246)" strokeWidth={0.4} />
            )}
            {points.length > 0 &&
              points.map(([x, y], i) => (
                <circle key={i} cx={x * 100} cy={y * 100} r={0.8} fill="rgb(59,130,246)" />
              ))}
          </svg>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={points.length === 0}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700 disabled:opacity-50"
            >
              {t("detectionZone.undoPoint")}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={points.length === 0}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700 disabled:opacity-50"
            >
              {t("detectionZone.clear")}
            </button>
          </div>
          <span className="text-xs text-neutral-500">{t("detectionZone.pointCount", { count: points.length })}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700">
            {t("detectionZone.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={points.length > 0 && points.length < 3}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500 disabled:opacity-50"
          >
            {t("detectionZone.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
