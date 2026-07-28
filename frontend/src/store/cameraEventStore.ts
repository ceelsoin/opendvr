import { create } from "zustand";

interface CameraEventState {
  flashingCameraIds: Set<string>;
  triggerFlash: (cameraId: string) => void;
}

const FLASH_DURATION_MS = 4000;

/** Tracks which cameras just had a motion/tamper event, for a brief green-glow highlight around their player (see GridPage's CameraTile). */
export const useCameraEventStore = create<CameraEventState>((set) => ({
  flashingCameraIds: new Set(),
  triggerFlash: (cameraId) => {
    set((state) => {
      const next = new Set(state.flashingCameraIds);
      next.add(cameraId);
      return { flashingCameraIds: next };
    });
    setTimeout(() => {
      set((state) => {
        const next = new Set(state.flashingCameraIds);
        next.delete(cameraId);
        return { flashingCameraIds: next };
      });
    }, FLASH_DURATION_MS);
  },
}));
