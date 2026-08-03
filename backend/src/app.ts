import path from "node:path";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { createProxyMiddleware } from "http-proxy-middleware";
import { apiRouter } from "./api/routes/index.js";
import { requireAuth } from "./auth/requireAuth.js";
import { logger } from "./lib/logger.js";
import { env } from "./config/env.js";

// Populated by `npm run build` (see scripts/build-frontend.js), which builds
// the frontend and copies its output here. Not present in dev, where the
// frontend is served separately by its own `npm start` (Vite dev server).
const webDir = path.join(__dirname, "web");

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  // app.use(pinoHttp({ logger }));

  // Protects everything below (API + media proxies) except the auth
  // endpoints themselves and the SPA static shell - see auth/requireAuth.ts.
  app.use(requireAuth);

  app.use("/api", apiRouter);

  // Reverse-proxies MediaMTX's HLS output so the browser only ever talks to
  // this server (same origin as /api and /web, no extra ports/CORS to deal
  // with). e.g. GET /hls/<cameraId>/index.m3u8 -> MEDIAMTX_HLS_URL/<cameraId>/index.m3u8
  app.use(
    "/hls",
    createProxyMiddleware({
      target: env.mediamtxHlsUrl,
      changeOrigin: true,
      pathRewrite: { "^/hls": "" },
      on: {
        proxyRes: (proxyRes) => {
          // MediaMTX issues an absolute-path redirect (e.g. for its HLS
          // session cookie handshake) assuming it's served at the root.
          // Since it's mounted under /hls here, that path needs the prefix
          // added back, or the browser's follow-up request misses this proxy.
          const location = proxyRes.headers.location;
          if (typeof location === "string" && location.startsWith("/") && !location.startsWith("/hls/")) {
            proxyRes.headers.location = `/hls${location}`;
          }
        },
      },
    })
  );

  // Reverse-proxies MediaMTX's Playback server (recorded footage), same
  // reasoning as the /hls proxy above: the browser only ever talks to this
  // origin. The frontend fetches segment lists from our own
  // /api/cameras/:id/recordings (which rewrites URLs to point here), then
  // requests the actual video bytes at GET /recordings/get?path=...&start=...&duration=...
  app.use(
    "/recordings",
    createProxyMiddleware({
      target: env.mediamtxPlaybackUrl,
      changeOrigin: true,
      pathRewrite: { "^/recordings": "" },
    })
  );

  // Serves JPEG snapshots captured on motion/tamper events (see
  // lib/snapshotStorage.ts + onvif/events.ts), at
  // /snapshots/<cameraId>/<eventId>.jpg.
  app.use("/snapshots", express.static(env.snapshotsDir));

  if (fs.existsSync(webDir)) {
    app.use("/web", express.static(webDir));
    // SPA fallback: any GET under /web not matched by a static file above
    // is handled client-side by React Router.
    app.use("/web", (req, res, next) => {
      if (req.method !== "GET") {
        next();
        return;
      }
      res.sendFile(path.join(webDir, "index.html"));
    });
  } else {
    logger.warn({ webDir }, "Frontend build not found; /web will 404 until `npm run build` is executed");
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
