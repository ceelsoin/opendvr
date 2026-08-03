import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { Server, type Socket } from "socket.io";
import { getCookie, verifyAuthToken } from "../auth/token.js";
import { logger } from "../lib/logger.js";

let io: Server | null = null;

/**
 * Attaches Socket.IO to a server - called once for the plain-HTTP listener,
 * and again for the optional local-HTTPS listener (see config/env.ts's
 * `httpsCertFile`/`httpsKeyFile`) if one is running, so WebSocket clients
 * connecting over https:// get real-time updates too. Only the FIRST call
 * actually creates the `Server` instance (with its auth middleware/
 * connection handler); subsequent calls just `.attach()` another listener
 * to that SAME instance, so a single `io.emit(...)` (see
 * `emitCameraStatus`/webhooks.ts's event broadcasts) reaches clients
 * connected via either protocol - attaching a second, independent `Server`
 * instead would silently stop delivering broadcasts to whichever server
 * was attached first.
 */
export function initWebSocket(httpServer: HttpServer | HttpsServer): Server {
  if (io) {
    io.attach(httpServer);
    return io;
  }

  io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  // Same session cookie used by the REST API - rejects the handshake
  // outright if there's no valid (non-expired) session, so a logged-out/
  // expired client doesn't keep receiving live camera:event/status updates.
  io.use((socket, next) => {
    const token = getCookie(socket.handshake.headers.cookie, "token");
    const payload = token ? verifyAuthToken(token) : null;
    if (!payload) {
      next(new Error("Unauthorized"));
      return;
    }
    next();
  });

  io.on("connection", (socket: Socket) => {
    logger.debug({ socketId: socket.id }, "Client connected via WebSocket");

    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "Client disconnected");
    });
  });

  return io;
}

export function emitCameraStatus(cameraId: string, status: string): void {
  io?.emit("camera:status", { cameraId, status });
}

export function emitEvent(cameraId: string, type: string, payload: Record<string, unknown> = {}): void {
  io?.emit("camera:event", { cameraId, type, ...payload, occurredAt: new Date().toISOString() });
}

/**
 * Broadcasts fresh detection boxes for the live-view overlay (see
 * frontend/src/components/player/HlsPlayer.tsx), independent of
 * `emitEvent`/`camera:event` above - the latter is deliberately debounced
 * to one DB row/notification per motion "session" (see
 * events/cameraEvents.ts), but the overlay should refresh on every single
 * classification (media/motionDetector.ts) for as long as something is
 * being tracked, or it'd only ever show a box once per session.
 */
export function emitDetections(cameraId: string, objects: unknown[]): void {
  io?.emit("camera:detections", { cameraId, objects });
}
