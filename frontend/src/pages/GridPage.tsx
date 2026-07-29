import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCameras } from "../api/cameras";
import { useDeleteGrid, useGrids } from "../api/grids";
import type { CustomGrid } from "../api/types";
import { CameraTile } from "../components/cameras/CameraTile";
import { GridBuilderDialog } from "../components/grids/GridBuilderDialog";
import { PtzTargetPanel } from "../components/ptz/PtzTargetPanel";
import { usePtzTargetStore } from "../store/ptzTargetStore";
import { useFitGrid } from "../lib/useFitGrid";

/** Remembers whether "fit all on screen" is on, so it stays set across visits. */
const FIT_ALL_STORAGE_KEY = "opendvr.grid.fitAll";

/** Builds the absolute, shareable URL for a custom grid's kiosk-style view (respects the /web/ base path in production). */
function customGridUrl(id: string): string {
  return new URL(`g/${id}`, window.location.origin + import.meta.env.BASE_URL).toString();
}

function CustomGridsSection() {
  const { t } = useTranslation();
  const { data: grids, isLoading } = useGrids();
  const deleteGrid = useDeleteGrid();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGrid, setEditingGrid] = useState<CustomGrid | undefined>(undefined);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const openCreateDialog = () => {
    setEditingGrid(undefined);
    setDialogOpen(true);
  };

  const openEditDialog = (grid: CustomGrid) => {
    setEditingGrid(grid);
    setDialogOpen(true);
  };

  const handleCopyUrl = async (id: string) => {
    try {
      await navigator.clipboard.writeText(customGridUrl(id));
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      // Clipboard API can fail (permissions, insecure context) - non-critical, URL is still visible/openable.
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm(t("grid.confirmDeleteGrid"))) {
      deleteGrid.mutate(id);
    }
  };

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("grid.myGrids")}</h2>
        <button
          type="button"
          onClick={openCreateDialog}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          {t("grid.createGrid")}
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-neutral-400">{t("grid.loadingGrids")}</p>
      ) : !grids || grids.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {t("grid.noneYet")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {grids.map((grid) => (
            <li
              key={grid.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-800 bg-neutral-900 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{grid.name}</p>
                <p className="text-xs text-neutral-500">
                  {t("grid.columns", { count: grid.columns })} · {t("grid.camerasCount", { count: grid.cameraIds.length })}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <a
                  href={customGridUrl(grid.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded px-2 py-1 text-blue-400 hover:bg-neutral-800"
                >
                  {t("grid.open")}
                </a>
                <button
                  type="button"
                  onClick={() => handleCopyUrl(grid.id)}
                  className="rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800"
                >
                  {copiedId === grid.id ? t("grid.urlCopied") : t("grid.copyUrl")}
                </button>
                <button
                  type="button"
                  onClick={() => openEditDialog(grid)}
                  className="rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800"
                >
                  {t("grid.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(grid.id)}
                  className="rounded px-2 py-1 text-red-400 hover:bg-neutral-800"
                >
                  {t("grid.remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <GridBuilderDialog open={dialogOpen} onClose={() => setDialogOpen(false)} grid={editingGrid} />
    </div>
  );
}

export function GridPage() {
  const { t } = useTranslation();
  const { data: cameras, isLoading } = useCameras();
  const clearPtzTarget = usePtzTargetStore((s) => s.clearTarget);
  const [fitAll, setFitAll] = useState(() => localStorage.getItem(FIT_ALL_STORAGE_KEY) === "1");
  const { containerRef: fitGridRef, layout: fitLayout } = useFitGrid(cameras?.length ?? 0, fitAll);

  useEffect(() => {
    localStorage.setItem(FIT_ALL_STORAGE_KEY, fitAll ? "1" : "0");
  }, [fitAll]);

  // Start each visit to this page with no PTZ target selected - a target
  // selected on another grid/page wouldn't necessarily still be visible here.
  useEffect(() => {
    clearPtzTarget();
    return () => clearPtzTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <CustomGridsSection />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("grid.allCameras")}</h2>
        {cameras && cameras.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-neutral-400" title={t("grid.fitAllHint")}>
            <input type="checkbox" checked={fitAll} onChange={(e) => setFitAll(e.target.checked)} />
            {t("grid.fitAllToggle")}
          </label>
        )}
      </div>
      {isLoading ? (
        <p className="text-neutral-400">{t("grid.loadingCameras")}</p>
      ) : !cameras || cameras.length === 0 ? (
        <div className="text-neutral-400">
          <p>{t("grid.noCamerasYet")}</p>
          <p className="text-sm">
            {t("grid.goToCamerasHint")}
          </p>
        </div>
      ) : fitAll ? (
        <div
          ref={fitGridRef}
          className="gap-3 overflow-hidden"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${fitLayout?.cols ?? 1}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${fitLayout?.rows ?? cameras.length}, 1fr)`,
            height: fitLayout ? `${fitLayout.heightPx}px` : undefined,
          }}
        >
          {cameras.map((camera) => (
            <CameraTile key={camera.id} camera={camera} fillHeight />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cameras.map((camera) => (
            <CameraTile key={camera.id} camera={camera} />
          ))}
        </div>
      )}
      <PtzTargetPanel />
    </div>
  );
}


