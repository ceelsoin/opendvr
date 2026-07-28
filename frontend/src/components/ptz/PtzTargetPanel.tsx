import { usePtzGotoPreset, usePtzPresets, usePtzSavePreset } from "../../api/ptz";
import { usePtzTargetStore } from "../../store/ptzTargetStore";
import { PtzJoystick } from "./PtzJoystick";

/**
 * Floating panel showing the joystick control for whichever camera is
 * currently selected as the PTZ target (see CameraTile's PTZ button +
 * ptzTargetStore). Mounted once per grid page (GridPage,
 * CustomGridViewPage) so it stays fixed on screen regardless of scroll,
 * instead of being embedded inline in each camera tile.
 */
export function PtzTargetPanel() {
  const target = usePtzTargetStore((s) => s.target);
  const clearTarget = usePtzTargetStore((s) => s.clearTarget);
  const cameraId = target?.id ?? "";

  const presets = usePtzPresets(cameraId, Boolean(target));
  const gotoPreset = usePtzGotoPreset(cameraId);
  const savePreset = usePtzSavePreset(cameraId);

  if (!target) return null;

  const handleSavePreset = () => {
    const name = window.prompt("Nome do preset:");
    if (name) savePreset.mutate(name);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-60 flex-col gap-3 rounded-xl border border-blue-500/40 bg-neutral-900/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-blue-400">
          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
          <span className="truncate">
            Controlando: <span className="text-neutral-200">{target.name}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={clearTarget}
          title="Fechar controle PTZ"
          className="shrink-0 text-neutral-500 hover:text-neutral-300"
        >
          ✕
        </button>
      </div>

      <div className="flex justify-center">
        <PtzJoystick cameraId={target.id} />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-neutral-800 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">Presets</span>
          <button
            type="button"
            onClick={handleSavePreset}
            className="text-[11px] text-neutral-400 hover:text-neutral-200"
          >
            + salvar posição
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.data?.map((preset) => (
            <button
              key={preset.token}
              type="button"
              onClick={() => gotoPreset.mutate(preset.token)}
              className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
            >
              {preset.name ?? preset.token}
            </button>
          ))}
          {!presets.data?.length && <span className="text-[11px] text-neutral-600">Nenhum preset salvo</span>}
        </div>
      </div>
    </div>
  );
}
