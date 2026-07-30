import type { NextFunction, Request, Response } from "express";
import { getCookie, verifyAuthToken } from "../auth/token.js";
import { getGridById, isCameraInPublicGrid } from "../db/grids.repository.js";

/**
 * Paths that never require a valid session - the auth endpoints themselves
 * (can't require a session to log in/check setup status), and the health
 * check (useful for infra monitoring without needing credentials).
 */
const PUBLIC_PATHS = new Set(["/api/auth/status", "/api/auth/login", "/api/auth/setup", "/api/health"]);

const PUBLIC_GRID_PATH_RE = /^\/api\/grids\/([^/]+)\/public$/;
// MediaMTX's HLS path segment for a camera's sub-stream is `<cameraId>_sub`
// (see media/mediamtx.ts's subStreamPathName) - strip that suffix so it
// still matches the underlying camera's id when checking grid membership.
const HLS_CAMERA_PATH_RE = /^\/hls\/([^/]+?)(?:_sub)?\//;

/**
 * Lets an anonymous viewer through for a grid marked `isPublic` (see
 * db/grids.repository.ts) and the HLS streams of the cameras it contains -
 * everything else (the authenticated /api/grids/:id, camera management,
 * recordings, etc.) still requires a session.
 */
function isPublicGridRequest(req: Request): boolean {
  if (req.method !== "GET") return false;

  const gridMatch = PUBLIC_GRID_PATH_RE.exec(req.path);
  if (gridMatch) {
    return getGridById(gridMatch[1])?.isPublic ?? false;
  }

  const hlsMatch = HLS_CAMERA_PATH_RE.exec(req.path);
  if (hlsMatch) {
    return isCameraInPublicGrid(hlsMatch[1]);
  }

  return false;
}

/**
 * Global auth gate: protects everything except the SPA shell itself
 * (`/web/*` - just app code, useless without API access), the whitelisted
 * public paths above, and public-grid viewing traffic. Mounted before the
 * routers in app.ts.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith("/web") || isPublicGridRequest(req)) {
    next();
    return;
  }

  const token = getCookie(req.headers.cookie, "token");
  const payload = token ? verifyAuthToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.user = payload;
  next();
}
