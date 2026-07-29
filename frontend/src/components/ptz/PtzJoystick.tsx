import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { usePtzMoveVector, usePtzStop } from "../../api/ptz";
import { extractErrorMessage } from "../../lib/apiError";
import { useToastStore } from "../../store/toastStore";

/** Container is 112px (h-28/w-28); this is how far the knob's center can travel from the middle, leaving room for its own radius so it never visually overflows the track. */
const MAX_TRAVEL_PX = 36;
/** Minimum time between move requests while dragging - fluid enough to feel responsive, without flooding the backend/camera with ONVIF calls. */
const SEND_THROTTLE_MS = 120;
/**
 * Some cameras' ONVIF ContinuousMove only keeps moving for a short
 * server-side `Timeout` (currently 1s, see backend/src/onvif/ptz.ts) since
 * their explicit Stop operation can't be relied on. Resending the current
 * vector on this interval - even while the pointer is held still, deflected
 * - keeps refreshing that timeout so "hold the joystick in one spot"
 * doesn't stop moving after 1s.
 */
const KEEPALIVE_INTERVAL_MS = 500;

/**
 * Analog joystick PTZ control: unlike the fixed 8-direction button grid
 * (components/ptz/PtzControls.tsx, used on the Cameras page), this sends an
 * arbitrary-angle pan/tilt vector (see `usePtzMoveVector`/`ptzMoveVector` on
 * the backend), so the camera can be panned smoothly in any direction at a
 * speed proportional to how far the knob is dragged from center.
 */
export function PtzJoystick({ cameraId }: { cameraId: string }) {
  const { t } = useTranslation();
  const moveVector = usePtzMoveVector(cameraId);
  const stop = usePtzStop(cameraId);
  const addToast = useToastStore((s) => s.addToast);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastSentAtRef = useRef(0);
  const lastVectorRef = useRef({ pan: 0, tilt: 0 });
  // Move fires up to ~8x/sec while dragging - if the camera/ONVIF call is
  // failing, that would otherwise spam one toast per request. Only the
  // first failure per drag gesture is shown (reset on pointer down).
  const errorShownRef = useRef(false);
  // These cameras' embedded ONVIF server is fragile enough that piling up
  // several concurrent PTZ requests (e.g. one still in flight/retrying when
  // the next throttled send or keep-alive tick fires) can overwhelm it and
  // cause a cascade of "socket hang up" failures - see backend/src/onvif/ptz.ts.
  // Skipping a send while one is already in flight keeps only one request
  // outstanding at a time; the next throttle/keep-alive tick will pick up
  // the latest vector anyway.
  const inFlightRef = useRef(false);
  const baseRef = useRef<HTMLDivElement | null>(null);

  const sendVector = useCallback(
    (pan: number, tilt: number) => {
      lastVectorRef.current = { pan, tilt };
      const now = Date.now();
      if (now - lastSentAtRef.current < SEND_THROTTLE_MS) return;
      if (inFlightRef.current) return;
      lastSentAtRef.current = now;
      inFlightRef.current = true;
      moveVector.mutate(
        { pan, tilt },
        {
          onError: (err) => {
            if (errorShownRef.current) return;
            errorShownRef.current = true;
            addToast("error", extractErrorMessage(err, t("ptz.moveFailed")));
          },
          onSettled: () => {
            inFlightRef.current = false;
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

  // Keeps resending the last vector while the joystick is held deflected
  // but not actively moving (no new pointermove events firing) - see
  // KEEPALIVE_INTERVAL_MS doc comment above for why this is needed.
  useEffect(() => {
    if (!dragging) return;
    const interval = setInterval(() => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      moveVector.mutate(lastVectorRef.current, {
        onSettled: () => {
          inFlightRef.current = false;
        },
      });
    }, KEEPALIVE_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    setKnob({ x: 0, y: 0 });
    stop.mutate(undefined, {
      onError: (err) => addToast("error", extractErrorMessage(err, t("ptz.stopFailed"))),
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
      <span className="text-[11px] text-neutral-500">{t("ptz.dragToMove")}</span>
    </div>
  );
}
