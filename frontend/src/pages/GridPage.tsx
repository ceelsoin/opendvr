import { useEffect, useState } from "react";
import { useCameras } from "../api/cameras";
import { useDeleteGrid, useGrids } from "../api/grids";
import type { CustomGrid } from "../api/types";
import { CameraTile } from "../components/cameras/CameraTile";
import { GridBuilderDialog } from "../components/grids/GridBuilderDialog";
import { PtzTargetPanel } from "../components/ptz/PtzTargetPanel";
import { usePtzTargetStore } from "../store/ptzTargetStore";

/** Builds the absolute, shareable URL for a custom grid's kiosk-style view (respects the /web/ base path in production). */
function customGridUrl(id: string): string {
  return new URL(`g/${id}`, window.location.origin + import.meta.env.BASE_URL).toString();
}

function CustomGridsSection() {
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
    if (window.confirm("Remover este grid? Isso não afeta as câmeras, só o layout salvo.")) {
      deleteGrid.mutate(id);
    }
  };

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Meus grids</h2>
        <button
          type="button"
          onClick={openCreateDialog}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          Criar grid
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-neutral-400">Carregando grids...</p>
      ) : !grids || grids.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nenhum grid customizado ainda. Crie um para escolher ordem, formato e câmeras, e ter uma URL própria
          para abrir num dispositivo específico.
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
                  {grid.columns} coluna{grid.columns > 1 ? "s" : ""} · {grid.cameraIds.length} câmera
                  {grid.cameraIds.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <a
                  href={customGridUrl(grid.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded px-2 py-1 text-blue-400 hover:bg-neutral-800"
                >
                  Abrir
                </a>
                <button
                  type="button"
                  onClick={() => handleCopyUrl(grid.id)}
                  className="rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800"
                >
                  {copiedId === grid.id ? "URL copiada!" : "Copiar URL"}
                </button>
                <button
                  type="button"
                  onClick={() => openEditDialog(grid)}
                  className="rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(grid.id)}
                  className="rounded px-2 py-1 text-red-400 hover:bg-neutral-800"
                >
                  Remover
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
  const { data: cameras, isLoading } = useCameras();
  const clearPtzTarget = usePtzTargetStore((s) => s.clearTarget);

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
      <h2 className="mb-3 text-base font-semibold">Todas as câmeras</h2>
      {isLoading ? (
        <p className="text-neutral-400">Carregando câmeras...</p>
      ) : !cameras || cameras.length === 0 ? (
        <div className="text-neutral-400">
          <p>Nenhuma câmera cadastrada ainda.</p>
          <p className="text-sm">
            Vá em <span className="text-neutral-200">Câmeras</span> para descobrir ou adicionar uma câmera ONVIF.
          </p>
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


