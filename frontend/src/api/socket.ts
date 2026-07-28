import { io } from "socket.io-client";

// withCredentials so the session cookie is sent on the WebSocket handshake
// (see backend/src/ws/index.ts's `io.use` auth check) - without it, the
// server rejects the connection as unauthenticated even for a logged-in user.
export const socket = io({
  autoConnect: true,
  transports: ["websocket"],
  withCredentials: true,
});
