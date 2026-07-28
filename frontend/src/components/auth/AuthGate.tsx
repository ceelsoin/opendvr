import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStatus } from "../../api/auth";

const PUBLIC_ROUTES = new Set(["/login", "/setup"]);

/**
 * Redirects to /setup (no account exists yet) or /login (account exists,
 * not authenticated) before rendering anything else. Sessions last 1h (see
 * backend/src/auth/token.ts) - once one expires, the next API call gets a
 * 401 and the axios interceptor (api/client.ts) bounces here too.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isLoading } = useAuthStatus();

  if (isLoading || !data) {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-500">…</div>;
  }

  if (!data.hasUser) {
    return location.pathname === "/setup" ? <>{children}</> : <Navigate to="/setup" replace />;
  }

  if (!data.authenticated) {
    return location.pathname === "/login" ? <>{children}</> : <Navigate to="/login" replace />;
  }

  if (PUBLIC_ROUTES.has(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
