import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";

export interface CaptionSettings {
  enabled: boolean;
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
  categoryPerson: boolean;
  categoryVehicle: boolean;
  categoryAnimal: boolean;
  categoryOther: boolean;
}

const CAPTIONING_KEY = ["settings", "captioning"] as const;

export function useCaptionSettings() {
  return useQuery({
    queryKey: CAPTIONING_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<CaptionSettings>("/settings/captioning");
      return data;
    },
  });
}

export function useUpdateCaptionSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<CaptionSettings>) => {
      const { data } = await apiClient.put<CaptionSettings>("/settings/captioning", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAPTIONING_KEY });
    },
  });
}
