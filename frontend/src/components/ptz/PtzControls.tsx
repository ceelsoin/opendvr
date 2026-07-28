import { usePtzGotoPreset, usePtzMove, usePtzPresets, usePtzSavePreset, usePtzStop, type PtzDirection } from "../../api/ptz";
import { extractErrorMessage } from "../../lib/apiError";
import { useToastStore } from "../../store/toastStore";

interface PtzControlsProps {
  cameraId: string;
}

const ARROWS: Array<{ direction: PtzDirection; label: string; className: string }> = [
  { direction: "upLeft", label: "↖", className: "col-start-1 row-start-1" },
  { direction: "up", label: "↑", className: "col-start-2 row-start-1" },
  { direction: "upRight", label: "↗", className: "col-start-3 row-start-1" },
  { direction: "left", label: "←", className: "col-start-1 row-start-2" },
  { direction: "right", label: "→", className: "col-start-3 row-start-2" },
  { direction: "downLeft", label: "↙", className: "col-start-1 row-start-3" },
  { direction: "down", label: "↓", className: "col-start-2 row-start-3" },
  { direction: "downRight", label: "↘", className: "col-start-3 row-start-3" },
];

export function PtzControls({ cameraId }: PtzControlsProps) {
  const move = usePtzMove(cameraId);
  const stop = usePtzStop(cameraId);
  const presets = usePtzPresets(cameraId, true);
  const gotoPreset = usePtzGotoPreset(cameraId);
  const savePreset = usePtzSavePreset(cameraId);
  const addToast = useToastStore((s) => s.addToast);

  const handleMove = (direction: PtzDirection) => {
    move.mutate(
      { direction },
      { onError: (err) => addToast("error", extractErrorMessage(err, "Falha ao mover a câmera (PTZ).")) }
    );
  };

  const handleStop = () => {
    stop.mutate(undefined, {
      onError: (err) => addToast("error", extractErrorMessage(err, "Falha ao parar o movimento PTZ.")),
    });
  };

  const handleSavePreset = () => {
    const name = window.prompt("Nome do preset:");
    if (name) {
      savePreset.mutate(name, {
        onError: (err) => addToast("error", extractErrorMessage(err, "Falha ao salvar o preset.")),
      });
    }
  };

  const handleGotoPreset = (token: string) => {
    gotoPreset.mutate(token, {
      onError: (err) => addToast("error", extractErrorMessage(err, "Falha ao ir para o preset.")),
    });
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="grid grid-cols-3 grid-rows-3 gap-1">
        {ARROWS.map(({ direction, label, className }) => (
          <button
            key={direction}
            type="button"
            className={`h-9 w-9 rounded-md bg-neutral-800 text-sm hover:bg-neutral-700 ${className}`}
            onMouseDown={() => handleMove(direction)}
            onMouseUp={handleStop}
            onMouseLeave={handleStop}
            onTouchStart={() => handleMove(direction)}
            onTouchEnd={handleStop}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="col-start-2 row-start-2 h-9 w-9 rounded-md bg-neutral-900 text-xs text-neutral-500"
          onClick={handleStop}
        >
          stop
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Presets</span>
          <button
            type="button"
            onClick={handleSavePreset}
            className="rounded-md px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Salvar posição atual
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.data?.map((preset) => (
            <button
              key={preset.token}
              type="button"
              onClick={() => handleGotoPreset(preset.token)}
              className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
            >
              {preset.name ?? preset.token}
            </button>
          ))}
          {!presets.data?.length && <span className="text-xs text-neutral-600">Nenhum preset salvo</span>}
        </div>
      </div>
    </div>
  );
}
