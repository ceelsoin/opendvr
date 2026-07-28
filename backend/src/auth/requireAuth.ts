import type { NextFunction, Request, Response } from "express";
import { getCookie, verifyAuthToken } from "../auth/token.js";

/**
 * Paths that never require a valid session - the auth endpoints themselves
 * (can't require a session to log in/check setup status), and the health
 * check (useful for infra monitoring without needing credentials).
 */
const PUBLIC_PATHS = new Set(["/api/auth/status", "/api/auth/login", "/api/auth/setup", "/api/health"]);

/**
 * Global auth gate: protects everything except the SPA shell itself
 * (`/web/*` - just app code, useless without API access) and the
 * whitelisted public paths above. Mounted before the routers in app.ts.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith("/web")) {
    next();
    return;
  }

  const token = getCookie(req.headers.cookie, "token");
  const payload = token ? verifyAuthToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
