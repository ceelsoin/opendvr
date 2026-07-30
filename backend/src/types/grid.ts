/** A user-defined camera grid: column count ("formato") + an ordered list of camera IDs ("ordem"/"câmeras"). */
export interface Grid {
  id: string;
  name: string;
  columns: number;
  cameraIds: string[];
  // When true, GET /api/grids/:id/public and the HLS streams for its
  // cameras bypass requireAuth - see auth/requireAuth.ts.
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGridInput {
  name: string;
  columns?: number;
  cameraIds: string[];
  isPublic?: boolean;
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
