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
// Short: motion_worker.py now sends a lightweight box-only "track" update
// on every analysis tick (~5/s) for as long as real motion is ongoing (see
// media/motionDetector.ts's `nudgeTrackPosition` handling), continuously
// resetting this timer - so it only ever needs to bridge one or two missed
// ticks, not the ~10s gap between full classified events like before. A
// short value here also means the box disappears quickly once the object
// actually stops moving, instead of lingering at its last (increasingly
// wrong) position.
const BOX_DURATION_MS = 2000;

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
