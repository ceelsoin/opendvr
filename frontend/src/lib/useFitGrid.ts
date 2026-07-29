import { useEffect, useRef, useState } from "react";

export interface FitGridLayout {
  cols: number;
  rows: number;
  /** Total height (px) the grid container should be given, so exactly `rows` of tiles fit without overflowing/scrolling. */
  heightPx: number;
}

/** Matches the gap-3 utility used on the grid container. */
const GAP_PX = 12;
/** Approximate height of CameraTile's name/status footer row below the video area, so column-count math accounts for it (not just the raw 16:9 video). */
const TILE_FOOTER_PX = 44;
const VIDEO_ASPECT = 16 / 9;
/** Small cushion so the last row doesn't visually touch the very bottom edge of the scroll container. */
const BOTTOM_MARGIN_PX = 8;
const MIN_HEIGHT_PX = 200;

/**
 * Computes how many columns/rows let `count` camera tiles (each ~16:9 video
 * + a small footer bar, like CameraTile) fit entirely within whatever
 * vertical space is available below the container - down to the bottom of
 * its nearest scrollable ancestor (`<main>` in this app's layout, see
 * AppLayout.tsx) - without needing to scroll to see them all.
 *
 * Uses the same approach video-conferencing "gallery view" grids use: try
 * every possible column count from 1 to `count`, compute the resulting
 * tile size for each, discard any that would overflow the available
 * height, and keep whichever feasible option yields the LARGEST tiles
 * (best use of space). Re-measures on resize and when `count` changes.
 */
export function useFitGrid(count: number, active: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<FitGridLayout | null>(null);

  useEffect(() => {
    if (!active || count <= 0) {
      setLayout(null);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    const recompute = () => {
      const scrollParent = container.closest<HTMLElement>("main") ?? document.documentElement;
      const containerRect = container.getBoundingClientRect();
      const parentRect = scrollParent.getBoundingClientRect();
      const availableWidth = containerRect.width;
      const availableHeight = Math.max(
        MIN_HEIGHT_PX,
        scrollParent.clientHeight - (containerRect.top - parentRect.top) - BOTTOM_MARGIN_PX
      );
      if (availableWidth <= 0) return;

      let best: FitGridLayout | null = null;
      let bestCellWidth = 0;
      for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const cellWidth = (availableWidth - (cols - 1) * GAP_PX) / cols;
        const cellHeight = cellWidth / VIDEO_ASPECT + TILE_FOOTER_PX;
        const totalHeight = rows * cellHeight + (rows - 1) * GAP_PX;
        if (totalHeight <= availableHeight && cellWidth > bestCellWidth) {
          bestCellWidth = cellWidth;
          best = { cols, rows, heightPx: availableHeight };
        }
      }
      // Extreme case (too many tiles for too little space): fall back to
      // the most columns possible - smaller tiles, but still no scroll.
      setLayout(best ?? { cols: count, rows: 1, heightPx: availableHeight });
    };

    recompute();
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(container);
    window.addEventListener("resize", recompute);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [count, active]);

  return { containerRef, layout };
}
