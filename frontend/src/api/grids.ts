import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";
import type { CreateGridInput, CustomGrid, UpdateGridInput } from "./types";

const GRIDS_KEY = ["grids"] as const;

export function useGrids() {
  return useQuery({
    queryKey: GRIDS_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<CustomGrid[]>("/grids");
      return data;
    },
  });
}

/** Used both by the grid builder (edit mode) and the public /g/:id view page. */
export function useGrid(id: string | undefined) {
  return useQuery({
    queryKey: [...GRIDS_KEY, id],
    queryFn: async () => {
      const { data } = await apiClient.get<CustomGrid>(`/grids/${id}`);
      return data;
    },
    enabled: Boolean(id),
  });
}

export function useCreateGrid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGridInput) => {
      const { data } = await apiClient.post<CustomGrid>("/grids", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GRIDS_KEY });
    },
  });
}

export function useUpdateGrid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateGridInput }) => {
      const { data } = await apiClient.patch<CustomGrid>(`/grids/${id}`, input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GRIDS_KEY });
    },
  });
}

export function useDeleteGrid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/grids/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GRIDS_KEY });
    },
  });
}
