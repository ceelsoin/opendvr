import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";

export interface AuthStatus {
  hasUser: boolean;
  authenticated: boolean;
}

export const AUTH_STATUS_KEY = ["auth", "status"] as const;

export function useAuthStatus() {
  return useQuery({
    queryKey: AUTH_STATUS_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<AuthStatus>("/auth/status");
      return data;
    },
    // Session can expire mid-session (1h) - keep this reasonably fresh
    // without hammering the endpoint.
    staleTime: 30_000,
  });
}

export interface Credentials {
  username: string;
  password: string;
}

export function useSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Credentials) => {
      const { data } = await apiClient.post<{ ok: true }>("/auth/setup", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Credentials) => {
      const { data } = await apiClient.post<{ ok: true }>("/auth/login", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.post("/auth/logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
    },
  });
}
