import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";

export interface KnownFace {
  id: string;
  name: string;
  createdAt: string;
}

const FACES_KEY = ["faces"] as const;

export function useFaces() {
  return useQuery({
    queryKey: FACES_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<KnownFace[]>("/faces");
      return data;
    },
  });
}

export function useCreateFace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; image: string }) => {
      const { data } = await apiClient.post<KnownFace>("/faces", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FACES_KEY });
    },
  });
}

export function useDeleteFace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/faces/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FACES_KEY });
    },
  });
}
