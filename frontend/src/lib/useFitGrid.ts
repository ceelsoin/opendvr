import { useLayoutEffect, useRef, useState } from "react";

export interface FitGridLayout {
  cols: number;
  rows: number;
  /** Explicit pixel width/height for each tile - set directly on each tile rather than relying on CSS Grid `fr` tracks, which need the container to already have a definite height to resolve correctly (fragile while this is still being measured). */
  cellWidthPx: number;
  cellHeightPx: number;
}

/** Matches the gap-3 utility used on the grid container. */
const GAP_PX = 12;
/** Approximate height of CameraTile's name/status footer row below the video area, so column-count math accounts for it (not just the raw 16:9 video). */
const TILE_FOOTER_PX = 44;
const VIDEO_ASPECT = 16 / 9;
/** Small cushion so the last row doesn't visually touch the very bottom edge of the scroll container. */
const BOTTOM_MARGIN_PX = 8;
const MIN_HEIGHT_PX = 200;
const MIN_WIDTH_PX = 160;

/**
 * Computes an explicit pixel width/height for `count` camera tiles (each
 * ~16:9 video + a small footer bar, like CameraTile) so all of them fit
 * entirely within whatever vertical space is available below the
 * container - down to the bottom of its nearest scrollable ancestor
 * (`<main>` in this app's layout, see AppLayout.tsx) - without needing to
 * scroll to see them all.
 *
 * Uses the same approach video-conferencing "gallery view" grids use: try
 * every possible column count from 1 to `count`, compute the resulting
 * tile size for each, discard any that would overflow the available
 * height, and keep whichever feasible option yields the LARGEST tiles
 * (best use of space). Sizes are applied directly as inline width/height on
 * each tile (not via CSS Grid `fr` rows/columns) so they're never left
 * ambiguous/collapsed while the container's own height is still indefinite.
 * `useLayoutEffect` (not `useEffect`) measures/applies this before the
 * browser paints, so there's no visible flash of a wrong/collapsed layout.
 */
export function useFitGrid(count: number, active: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<FitGridLayout | null>(null);

  useLayoutEffect(() => {
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
      const availableWidth = containerRect.width || scrollParent.clientWidth;
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
          best = { cols, rows, cellWidthPx: cellWidth, cellHeightPx: cellHeight };
        }
      }
      if (!best) {
        // Nothing fits height-wise even with the most columns possible
        // (extreme case: tons of cameras in a short viewport) - keep them
        // all on one row rather than collapsing to nothing, and let the
        // row itself be as tall as what's actually available.
        const cols = count;
        const cellWidth = Math.max(MIN_WIDTH_PX, (availableWidth - (cols - 1) * GAP_PX) / cols);
        best = { cols, rows: 1, cellWidthPx: cellWidth, cellHeightPx: availableHeight };
      }
      setLayout(best);
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
