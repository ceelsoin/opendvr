import pino from "pino";
import { Writable } from "node:stream";
import { env } from "../config/env.js";
import { pushLogEntry } from "./logBuffer.js";

// Tees every log line into the in-memory ring buffer (lib/logBuffer.ts) in
// addition to wherever it would normally go (stdout in production,
// pino-pretty in dev) - powers the Maintenance page's log viewer and the
// per-camera restart/test-connection log modals. Pino writes one
// newline-delimited JSON object per call regardless of level/transport, so
// this just parses each line back into an object.
const ringBufferStream = new Writable({
  write(chunk, _encoding, callback) {
    try {
      const line = chunk.toString("utf8").trim();
      if (line) {
        pushLogEntry(JSON.parse(line));
      }
    } catch {
      // Malformed/partial line - drop it, never let log capture itself crash the app.
    }
    callback();
  },
});

const primaryStream =
  env.nodeEnv === "production"
    ? process.stdout
    : pino.transport({ target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } });

export const logger = pino(
  { level: env.nodeEnv === "production" ? "info" : "debug" },
  pino.multistream([{ stream: primaryStream }, { stream: ringBufferStream }])
);

