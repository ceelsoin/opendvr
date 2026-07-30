import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useCameras } from "../api/cameras";
import { useGrid, usePublicGrid } from "../api/grids";
import { CameraTile } from "../components/cameras/CameraTile";
import { HlsPlayer } from "../components/player/HlsPlayer";
import { PtzTargetPanel } from "../components/ptz/PtzTargetPanel";
import { usePtzTargetStore } from "../store/ptzTargetStore";

/**
 * Standalone, kiosk-style view of a single custom grid (no sidebar/nav) -
 * this is the "unique URL" a specific device can be pointed at
 * permanently. Route lives outside AppLayout (see App.tsx) on purpose.
 *
 * Tries the public (no-session) endpoint first - works for anyone when the
 * grid is marked public. Only falls back to the authenticated path (which
 * needs a valid session) once we know the grid isn't public, so a private
 * grid still renders normally for a logged-in user.
 */
export function CustomGridViewPage() {
  const { id } = useParams<{ id: string }>();
  const clearPtzTarget = usePtzTargetStore((s) => s.clearTarget);

  useEffect(() => {
    clearPtzTarget();
    return () => clearPtzTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publicGrid = usePublicGrid(id);
  const useAuthFallback = publicGrid.isError;

  const {
    data: grid,
    isLoading: isGridLoading,
    isError: isGridError,
  } = useGrid(useAuthFallback ? id : undefined);
  const { data: cameras, isLoading: isCamerasLoading } = useCameras({ enabled: useAuthFallback });

  if (publicGrid.isPending || (useAuthFallback && (isGridLoading || isCamerasLoading))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">
        Carregando grid...
      </div>
    );
  }

  if (publicGrid.data) {
    return (
      <div className="min-h-screen bg-neutral-950 p-4 text-neutral-100">
        <h1 className="mb-4 text-lg font-semibold">{publicGrid.data.name}</h1>
        {publicGrid.data.cameras.length === 0 ? (
          <p className="text-neutral-400">Nenhuma câmera disponível neste grid.</p>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${publicGrid.data.columns}, minmax(0, 1fr))` }}
          >
            {publicGrid.data.cameras.map((camera) => (
              <div key={camera.id} className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                <div className="aspect-video">
                  <HlsPlayer
                    src={`/hls/${camera.hasSubStream ? `${camera.id}_sub` : camera.id}/index.m3u8`}
                    className="h-full w-full"
                  />
                </div>
                <p className="truncate px-3 py-1.5 text-sm">{camera.name}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!useAuthFallback || isGridError || !grid) {
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
