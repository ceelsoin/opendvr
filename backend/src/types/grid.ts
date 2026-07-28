/** A user-defined camera grid: column count ("formato") + an ordered list of camera IDs ("ordem"/"câmeras"). */
export interface Grid {
  id: string;
  name: string;
  columns: number;
  cameraIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateGridInput {
  name: string;
  columns?: number;
  cameraIds: string[];
}

export type UpdateGridInput = Partial<CreateGridInput>;
