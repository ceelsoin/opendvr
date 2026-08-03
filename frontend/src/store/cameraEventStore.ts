import { create } from "zustand";
import type { DetectionBox } from "../api/types";

interface CameraEventState {
  flashingCameraIds: Set<string>;
  triggerFlash: (cameraId: string) => void;
  /** Latest detection boxes per camera, for the live overlay (see HlsPlayer.tsx) - cleared automatically after BOX_DURATION_MS, same idea as the flash below. */
  detectionsByCamera: Record<string, DetectionBox[]>;
  setDetections: (cameraId: string, detections: DetectionBox[]) => void;
}

const FLASH_DURATION_MS = 4000;
// A bit longer than motion_worker.py's own ~10s per-camera debounce (see
// EVENT_DEBOUNCE_S there), so the box stays visible through the gap
// between consecutive triggers of the same ongoing motion instead of
// flickering off and back on every cycle.
const BOX_DURATION_MS = 12000;

// Pending clear-timers, keyed by cameraId - a NEW call must cancel any
// previous one before scheduling its own, otherwise an earlier timer can
// fire after newer data arrived and incorrectly wipe it out early.
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
const detectionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Tracks which cameras just had a motion/tamper event, for a brief green-glow highlight around their player (see GridPage's CameraTile), and the latest detection boxes for the live overlay. */
export const useCameraEventStore = create<CameraEventState>((set) => ({
  flashingCameraIds: new Set(),
  triggerFlash: (cameraId) => {
    clearTimeout(flashTimers.get(cameraId));
    set((state) => {
      const next = new Set(state.flashingCameraIds);
      next.add(cameraId);
      return { flashingCameraIds: next };
    });
    flashTimers.set(
      cameraId,
      setTimeout(() => {
        flashTimers.delete(cameraId);
        set((state) => {
          const next = new Set(state.flashingCameraIds);
          next.delete(cameraId);
          return { flashingCameraIds: next };
        });
      }, FLASH_DURATION_MS)
    );
  },
  detectionsByCamera: {},
  setDetections: (cameraId, detections) => {
    clearTimeout(detectionTimers.get(cameraId));
    set((state) => ({ detectionsByCamera: { ...state.detectionsByCamera, [cameraId]: detections } }));
    detectionTimers.set(
      cameraId,
      setTimeout(() => {
        detectionTimers.delete(cameraId);
        set((state) => {
          const { [cameraId]: _removed, ...rest } = state.detectionsByCamera;
          return { detectionsByCamera: rest };
        });
      }, BOX_DURATION_MS)
    );
  },
}));
