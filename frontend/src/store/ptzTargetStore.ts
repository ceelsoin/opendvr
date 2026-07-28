import { create } from "zustand";

export interface PtzTarget {
  id: string;
  name: string;
}

interface PtzTargetState {
  target: PtzTarget | null;
  setTarget: (target: PtzTarget) => void;
  /** Selecting the already-active camera again deselects it (toggle behavior). */
  toggleTarget: (target: PtzTarget) => void;
  clearTarget: () => void;
}

/**
 * Tracks which camera is the current target of the joystick-style PTZ
 * control on GridPage/CustomGridViewPage. Global (not per-page state)
 * because the trigger button lives on CameraTile (rendered in a list) while
 * the actual joystick lives in a single floating panel mounted once per
 * page - this avoids prop-drilling through the camera list.
 */
export const usePtzTargetStore = create<PtzTargetState>((set, get) => ({
  target: null,
  setTarget: (target) => set({ target }),
  toggleTarget: (target) => {
    const current = get().target;
    set({ target: current?.id === target.id ? null : target });
  },
  clearTarget: () => set({ target: null }),
}));
