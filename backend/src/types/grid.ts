/**
 * Optional single-stream broadcast for a grid, meant for a dumb client
 * (VLC, a smart TV, a small device like an Orange Pi) to point at and leave
 * playing - no interactive page, no login. "off": disabled (default).
 * "mosaic": one ffmpeg process combines every camera into a single
 * side-by-side frame (layout follows the grid's own `columns`), encoded
 * once. "rotation": switches between cameras one at a time, holding each
 * for `broadcastIntervalSeconds` - see media/gridBroadcastBridge.ts.
 */
export type GridBroadcastMode = "off" | "mosaic" | "rotation";

/** A user-defined camera grid: column count ("formato") + an ordered list of camera IDs ("ordem"/"câmeras"). */
export interface Grid {
  id: string;
  name: string;
  columns: number;
  cameraIds: string[];
  // When true, GET /api/grids/:id/public and the HLS streams for its
  // cameras bypass requireAuth - see auth/requireAuth.ts.
  isPublic: boolean;
  broadcastMode: GridBroadcastMode;
  /** Only meaningful when broadcastMode === "rotation". */
  broadcastIntervalSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGridInput {
  name: string;
  columns?: number;
  cameraIds: string[];
  isPublic?: boolean;
  broadcastMode?: GridBroadcastMode;
  broadcastIntervalSeconds?: number;
}

/** Minimal, credential-free camera shape served by the public grid endpoint. */
export interface PublicGridCamera {
  id: string;
  name: string;
  rotation: 0 | 90 | 180 | 270;
  hasSubStream: boolean;
}

export interface PublicGrid {
  id: string;
  name: string;
  columns: number;
  cameras: PublicGridCamera[];
}

export type UpdateGridInput = Partial<CreateGridInput>;
