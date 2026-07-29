import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePtzGotoPreset, usePtzMove, usePtzPresets, usePtzSavePreset, usePtzStop, type PtzDirection } from "../../api/ptz";
import { extractErrorMessage } from "../../lib/apiError";
import { useToastStore } from "../../store/toastStore";

interface PtzControlsProps {
  cameraId: string;
}

/**
 * Some cameras' ONVIF ContinuousMove only keeps moving for a short
 * server-side `Timeout` (currently 1s, see backend/src/onvif/ptz.ts) since
 * their explicit Stop operation can't be relied on. Resending the move
 * command on this interval while a button is held refreshes that timeout
 * so holding a direction for longer than 1s doesn't silently stop moving.
 */
const HOLD_REPEAT_MS = 500;

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
  const { t } = useTranslation();
  const move = usePtzMove(cameraId);
  const stop = usePtzStop(cameraId);
  const presets = usePtzPresets(cameraId, true);
  const gotoPreset = usePtzGotoPreset(cameraId);
  const savePreset = usePtzSavePreset(cameraId);
  const addToast = useToastStore((s) => s.addToast);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // These cameras' embedded ONVIF server is fragile enough that piling up
  // concurrent PTZ requests (e.g. the hold-repeat interval firing again
  // before the previous move settled/retried) can overwhelm it and cause a
  // cascade of "socket hang up" failures - see backend/src/onvif/ptz.ts.
  const inFlightRef = useRef(false);

  const handleMove = (direction: PtzDirection) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    move.mutate(
      { direction },
      {
        onError: (err) => addToast("error", extractErrorMessage(err, t("ptz.moveFailed"))),
        onSettled: () => {
          inFlightRef.current = false;
        },
      }
    );
  };

  const handleStop = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    stop.mutate(undefined, {
      onError: (err) => addToast("error", extractErrorMessage(err, t("ptz.stopFailed"))),
    });
  };

  /** Starts moving immediately, then keeps refreshing it (see HOLD_REPEAT_MS) for as long as the button stays held. */
  const handleHoldStart = (direction: PtzDirection) => {
    handleMove(direction);
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = setInterval(() => handleMove(direction), HOLD_REPEAT_MS);
  };

  const handleSavePreset = () => {
    const name = window.prompt(t("ptz.presetNamePrompt"));
    if (name) {
      savePreset.mutate(name, {
        onError: (err) => addToast("error", extractErrorMessage(err, t("ptz.savePresetFailed"))),
      });
    }
  };

  const handleGotoPreset = (token: string) => {
    gotoPreset.mutate(token, {
      onError: (err) => addToast("error", extractErrorMessage(err, t("ptz.gotoPresetFailed"))),
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
            onMouseDown={() => handleHoldStart(direction)}
            onMouseUp={handleStop}
            onMouseLeave={handleStop}
            onTouchStart={() => handleHoldStart(direction)}
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
          <span className="text-xs text-neutral-500">{t("ptz.presetsLabel")}</span>
          <button
            type="button"
            onClick={handleSavePreset}
            className="rounded-md px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {t("ptz.savePresetButton")}
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
          {!presets.data?.length && <span className="text-xs text-neutral-600">{t("ptz.noPresets")}</span>}
        </div>
      </div>
    </div>
  );
}
