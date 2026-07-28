import { create } from "zustand";

export type GridLayoutSize = "1x1" | "2x2" | "3x3" | "4x4";

interface UiState {
  gridLayout: GridLayoutSize;
  selectedCameraId: string | null;
  setGridLayout: (layout: GridLayoutSize) => void;
  setSelectedCameraId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  gridLayout: "2x2",
  selectedCameraId: null,
  setGridLayout: (gridLayout) => set({ gridLayout }),
  setSelectedCameraId: (selectedCameraId) => set({ selectedCameraId }),
}));
