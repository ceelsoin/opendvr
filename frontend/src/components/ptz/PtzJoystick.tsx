import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePtzMoveVector, usePtzStop } from "../../api/ptz";
import { extractErrorMessage } from "../../lib/apiError";
import { useToastStore } from "../../store/toastStore";

/** Container is 112px (h-28/w-28); this is how far the knob's center can travel from the middle, leaving room for its own radius so it never visually overflows the track. */
const MAX_TRAVEL_PX = 36;
/** Minimum time between move requests while dragging - fluid enough to feel responsive, without flooding the backend/camera with ONVIF calls. */
const SEND_THROTTLE_MS = 120;

/**
 * Analog joystick PTZ control: unlike the fixed 8-direction button grid
 * (components/ptz/PtzControls.tsx, used on the Cameras page), this sends an
 * arbitrary-angle pan/tilt vector (see `usePtzMoveVector`/`ptzMoveVector` on
 * the backend), so the camera can be panned smoothly in any direction at a
 * speed proportional to how far the knob is dragged from center.
 */
export function PtzJoystick({ cameraId }: { cameraId: string }) {
  const moveVector = usePtzMoveVector(cameraId);
  const stop = usePtzStop(cameraId);
  const addToast = useToastStore((s) => s.addToast);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastSentAtRef = useRef(0);
  // Move fires up to ~8x/sec while dragging - if the camera/ONVIF call is
  // failing, that would otherwise spam one toast per request. Only the
  // first failure per drag gesture is shown (reset on pointer down).
  const errorShownRef = useRef(false);
  const baseRef = useRef<HTMLDivElement | null>(null);

  const sendVector = useCallback(
    (pan: number, tilt: number) => {
      const now = Date.now();
      if (now - lastSentAtRef.current < SEND_THROTTLE_MS) return;
      lastSentAtRef.current = now;
      moveVector.mutate(
        { pan, tilt },
        {
          onError: (err) => {
            if (errorShownRef.current) return;
            errorShownRef.current = true;
            addToast("error", extractErrorMessage(err, "Falha ao mover a câmera (PTZ)."));
          },
        }
      );
    },
    [moveVector]
  );

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const dx0 = clientX - (rect.left + rect.width / 2);
      const dy0 = clientY - (rect.top + rect.height / 2);
      const distance = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      const scale = distance > MAX_TRAVEL_PX ? MAX_TRAVEL_PX / distance : 1;
      const dx = dx0 * scale;
      const dy = dy0 * scale;
      setKnob({ x: dx, y: dy });
      // Screen Y grows downward; ONVIF tilt should be positive = up, so invert.
      sendVector(dx / MAX_TRAVEL_PX, -dy / MAX_TRAVEL_PX);
    },
    [sendVector]
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    errorShownRef.current = false;
    updateFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    updateFromPointer(e.clientX, e.clientY);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    setKnob({ x: 0, y: 0 });
    stop.mutate(undefined, {
      onError: (err) => addToast("error", extractErrorMessage(err, "Falha ao parar o movimento PTZ.")),
    });
  };

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div
        ref={baseRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative flex h-28 w-28 touch-none items-center justify-center rounded-full border border-neutral-700 bg-neutral-950"
      >
        <div className="absolute h-full w-full rounded-full bg-gradient-to-br from-neutral-800/40 to-transparent" />
        <div
          className={`h-10 w-10 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)] ${
            dragging ? "" : "transition-transform duration-150"
          }`}
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>
      <span className="text-[11px] text-neutral-500">Arraste para mover</span>
    </div>
  );
}
