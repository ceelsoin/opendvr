import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { getCookie, verifyAuthToken } from "../auth/token.js";
import { logger } from "../lib/logger.js";

let io: Server | null = null;

export function initWebSocket(httpServer: HttpServer): Server {
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
