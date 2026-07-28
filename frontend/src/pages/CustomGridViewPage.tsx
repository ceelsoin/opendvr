import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useCameras } from "../api/cameras";
import { useGrid } from "../api/grids";
import { CameraTile } from "../components/cameras/CameraTile";
import { PtzTargetPanel } from "../components/ptz/PtzTargetPanel";
import { usePtzTargetStore } from "../store/ptzTargetStore";

/**
 * Standalone, kiosk-style view of a single custom grid (no sidebar/nav) -
 * this is the "unique URL" a specific device can be pointed at
 * permanently. Route lives outside AppLayout (see App.tsx) on purpose.
 */
export function CustomGridViewPage() {
  const { id } = useParams<{ id: string }>();
  const { data: grid, isLoading: isGridLoading, isError: isGridError } = useGrid(id);
  const { data: cameras, isLoading: isCamerasLoading } = useCameras();
  const clearPtzTarget = usePtzTargetStore((s) => s.clearTarget);

  useEffect(() => {
    clearPtzTarget();
    return () => clearPtzTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isGridLoading || isCamerasLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">
        Carregando grid...
      </div>
    );
  }

  if (isGridError || !grid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">
        Grid não encontrado. Verifique a URL.
      </div>
    );
  }

  const orderedCameras = grid.cameraIds
    .map((cameraId) => cameras?.find((c) => c.id === cameraId))
    .filter((camera): camera is NonNullable<typeof camera> => Boolean(camera));

  return (
    <div className="min-h-screen bg-neutral-950 p-4 text-neutral-100">
      <h1 className="mb-4 text-lg font-semibold">{grid.name}</h1>
      {orderedCameras.length === 0 ? (
        <p className="text-neutral-400">Nenhuma câmera disponível neste grid.</p>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}>
          {orderedCameras.map((camera) => (
            <CameraTile key={camera.id} camera={camera} />
          ))}
        </div>
      )}
      <PtzTargetPanel />
    </div>
  );
}
