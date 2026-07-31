import type { NextFunction, Request, Response } from "express";
import { getCookie, verifyAuthToken } from "../auth/token.js";
import { getGridById, isCameraInPublicGrid, isGridBroadcastEnabled } from "../db/grids.repository.js";

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
// A grid's broadcast stream (see media/gridBroadcastBridge.ts) lives at its
// own `grid_<id>` MediaMTX path - distinct from HLS_CAMERA_PATH_RE above,
// which only ever matches actual camera ids.
const HLS_GRID_BROADCAST_PATH_RE = /^\/hls\/grid_([^/]+)\//;

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

  // Checked before HLS_CAMERA_PATH_RE - grid broadcast paths are prefixed
  // `grid_`, which would otherwise also match that pattern (and always
  // fail its camera-id lookup) since both target `/hls/<segment>/...`.
  const broadcastMatch = HLS_GRID_BROADCAST_PATH_RE.exec(req.path);
  if (broadcastMatch) {
    // Enabling broadcast mode IS the explicit consent to expose this one
    // stream without a session - independent of the grid's own `isPublic`
    // (interactive page) setting, since there's no other way to
    // authenticate a TV/VLC/Orange Pi pointed at a bare HLS URL.
    return isGridBroadcastEnabled(broadcastMatch[1]);
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
