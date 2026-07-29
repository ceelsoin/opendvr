/**
 * In-memory ring buffer of recent log entries, fed by every `logger.*()`
 * call app-wide (see lib/logger.ts, which tees pino's output into this via
 * a custom Writable stream) - powers the Maintenance page's log viewer and
 * the per-camera "restart"/"test connection" log modals on the Cameras
 * page. Deliberately NOT persisted to disk or a DB table: this is a
 * lightweight tail of recent activity for live troubleshooting, not an
 * audit log - it resets on every restart, same as before this existed
 * (logs just went to stdout).
 */
export interface LogEntry {
  /** Monotonically increasing id, used for "give me everything after X" polling instead of re-sending the whole buffer every time. */
  seq: number;
  /** pino's numeric level (10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal). */
  level: number;
  time: number;
  msg?: string;
  cameraId?: string;
  [key: string]: unknown;
}

const MAX_ENTRIES = 2000;
const buffer: LogEntry[] = [];
let nextSeq = 1;

export function pushLogEntry(raw: Record<string, unknown>): void {
  const entry: LogEntry = {
    ...raw,
    seq: nextSeq++,
    level: typeof raw.level === "number" ? raw.level : 30,
    time: typeof raw.time === "number" ? raw.time : Date.now(),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
}

export interface GetLogEntriesOptions {
  /** Only entries for this camera (matches the `cameraId` field logged alongside most camera-related operations). */
  cameraId?: string;
  /** Only entries with seq strictly greater than this - for incremental polling. */
  afterSeq?: number;
  limit?: number;
}

export function getLogEntries(options: GetLogEntriesOptions = {}): LogEntry[] {
  let result = buffer as LogEntry[];
  if (options.afterSeq !== undefined) {
    const afterSeq = options.afterSeq;
    result = result.filter((e) => e.seq > afterSeq);
  }
  if (options.cameraId) {
    result = result.filter((e) => e.cameraId === options.cameraId);
  }
  const limit = options.limit ?? 500;
  return result.slice(-limit);
}

export function getLastLogSeq(): number {
  return nextSeq - 1;
}
