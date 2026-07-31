import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

fs.mkdirSync(path.dirname(env.dbFile), { recursive: true });
fs.mkdirSync(env.recordingsDir, { recursive: true });
fs.mkdirSync(env.snapshotsDir, { recursive: true });

export const db = new Database(env.dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 80,
    onvif_path TEXT NOT NULL DEFAULT '/onvif/device_service',
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    rtsp_main_uri TEXT,
    rtsp_sub_uri TEXT,
    onvif_profile_token TEXT,
    onvif_sub_profile_token TEXT,
    has_ptz INTEGER NOT NULL DEFAULT 0,
    continuous_recording INTEGER NOT NULL DEFAULT 0,
    motion_recording INTEGER NOT NULL DEFAULT 1,
    retention_days INTEGER NOT NULL DEFAULT 7,
    status TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    kind TEXT NOT NULL DEFAULT 'continuous',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recordings_camera_time
    ON recordings(camera_id, start_time)`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_camera_time
    ON events(camera_id, occurred_at)`,
  // Custom grids: user-defined layout (column count + ordered camera
  // selection). The row's `id` doubles as the unique, shareable/viewable
  // URL segment (GET /api/grids/:id has no auth, same as the rest of the
  // API), so a grid can be pinned to a specific device via `/g/:id`. When
  // `is_public` is set, GET /api/grids/:id/public and the HLS streams for
  // its cameras also bypass requireAuth - see auth/requireAuth.ts.
  `CREATE TABLE IF NOT EXISTS grids (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    columns INTEGER NOT NULL DEFAULT 3,
    camera_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Generic runtime-editable key/value settings store (currently used for
  // notification channels - see notifications/notificationSettings.ts) so
  // they can be changed from the UI without restarting the container. A
  // value missing here falls back to the equivalent env var.
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  // Local login accounts (see auth/*.ts). The Setup page only appears when
  // this table is empty; once at least one account exists, /login is used
  // instead. Deliberately simple - no roles/permissions, this app is meant
  // for a single trusted admin (or a small household), not multi-tenant use.
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Web Push subscriptions (browser/PWA push notifications, see
  // lib/webPush.ts + db/pushSubscriptions.repository.ts). One row per
  // browser/device that opted in from the Settings page - `endpoint` (the
  // push service URL assigned by the browser) is unique per subscription
  // and doubles as the primary key, so re-subscribing the same
  // browser/device just updates its keys instead of duplicating rows.
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Known faces for face recognition (see media/objectDetection.ts +
  // media/visionWorker.ts). `embedding` is a JSON array of floats (SFace's
  // 128-d output) computed once at enrollment time; matching happens
  // in-process via cosine similarity, no vector DB needed at this scale.
  `CREATE TABLE IF NOT EXISTS known_faces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    embedding TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

export function runMigrations(): void {
  const applied = db.transaction(() => {
    for (const statement of MIGRATIONS) {
      db.exec(statement);
    }
  });
  applied();
  applyColumnMigrations();
  backfillRecordingMode();
  logger.info("Database migrations applied");
}

/**
 * One-time backfill for the new `recording_mode` column: pre-existing rows
 * get it added with a default of 'off' (see COLUMN_MIGRATIONS below), which
 * would silently stop recording for cameras that had `continuous_recording`
 * set. Only touches rows that still look untouched (recording_mode='off'),
 * so it's safe to run on every boot without clobbering an explicit choice
 * (e.g. the user picking 'off' on purpose for a camera that also happens to
 * have the old continuous_recording flag set).
 */
function backfillRecordingMode(): void {
  db.prepare(
    `UPDATE cameras SET recording_mode = 'continuous' WHERE continuous_recording = 1 AND recording_mode = 'off'`
  ).run();
}

/**
 * Additive column migrations, applied idempotently by checking existing
 * columns first (SQLite has no "ADD COLUMN IF NOT EXISTS"). Needed for
 * upgrading databases created before a column was introduced.
 */
const COLUMN_MIGRATIONS: Record<string, string[]> = {
  cameras: [
    "ALTER TABLE cameras ADD COLUMN onvif_path TEXT NOT NULL DEFAULT '/onvif/device_service'",
    "ALTER TABLE cameras ADD COLUMN onvif_sub_profile_token TEXT",
    "ALTER TABLE cameras ADD COLUMN rtsp_compat_mode TEXT",
    // Stream metadata from ONVIF discovery (resolution/encoding), so the
    // edit form can show it again without re-probing the camera.
    "ALTER TABLE cameras ADD COLUMN main_stream_width INTEGER",
    "ALTER TABLE cameras ADD COLUMN main_stream_height INTEGER",
    "ALTER TABLE cameras ADD COLUMN main_stream_encoding TEXT",
    "ALTER TABLE cameras ADD COLUMN sub_stream_width INTEGER",
    "ALTER TABLE cameras ADD COLUMN sub_stream_height INTEGER",
    "ALTER TABLE cameras ADD COLUMN sub_stream_encoding TEXT",
    // Recording mode radio (off/continuous/motion), superseding the old
    // binary continuous_recording checkbox (left in place, unused).
    "ALTER TABLE cameras ADD COLUMN recording_mode TEXT NOT NULL DEFAULT 'off'",
    // Which signal drives motion alerts/recording: ONVIF PullPoint events
    // (default, unchanged behavior) or local video analysis (OpenCV MOG2,
    // see media/motionDetector.ts) - needed for cameras whose ONVIF Events
    // service doesn't actually work despite advertising support.
    "ALTER TABLE cameras ADD COLUMN motion_detection_source TEXT NOT NULL DEFAULT 'onvif'",
    // Administrative on/off switch (POST /cameras/:id/enable|disable) -
    // distinct from `status`, which reflects connectivity. A disabled
    // camera has its MediaMTX path/motion listener/VLC relay torn down and
    // is skipped entirely on boot/reconcile, but stays in the DB so its
    // config isn't lost.
    "ALTER TABLE cameras ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
    // Which protocol is used for this camera's video source: "onvif" (the
    // original/default full ONVIF flow) or a directly-entered URL of type
    // "rtsp"/"rtmp"/"hls"/"srt" (no ONVIF discovery for video at all -
    // ONVIF connection fields may still be filled in just for PTZ, see
    // types/camera.ts's CameraSourceType doc comment). Existing rows
    // default to 'onvif' to preserve current behavior exactly.
    "ALTER TABLE cameras ADD COLUMN source_type TEXT NOT NULL DEFAULT 'onvif'",
    // Clockwise video rotation (0/90/180/270) applied via an ffmpeg
    // transcode bridge before MediaMTX, for cameras mounted sideways/upside
    // down. 0 = no rotation, no transcoding (unchanged direct pull/relay
    // behavior) - see media/rotationBridge.ts.
    "ALTER TABLE cameras ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0",
    // AI object detection (YOLO, via the shared media/visionWorker.ts
    // process) gate: only runs on frames that already triggered the
    // existing OpenCV motion detector (media/motionDetector.ts), and only
    // for cameras that opt in here - keeps CPU cost bounded on weak
    // hardware (see docs/configuration.md). Default 0 (off) so existing
    // installs keep their current behavior unless explicitly enabled.
    "ALTER TABLE cameras ADD COLUMN object_detection_enabled INTEGER NOT NULL DEFAULT 0",
    // Face recognition (OpenCV YuNet+SFace) gate: only ever runs on frames
    // where object detection already classified a "person", so this has no
    // effect unless object_detection_enabled is also on.
    "ALTER TABLE cameras ADD COLUMN face_recognition_enabled INTEGER NOT NULL DEFAULT 0",
    // Optional "zone of interest" polygon (JSON: {"points":[[x,y],...]},
    // normalized 0..1 so it's resolution-independent), used to ignore
    // detections outside the area the user actually cares about (e.g. the
    // public sidewalk visible through a gate). NULL = no zone, everything
    // in-frame counts (unchanged behavior).
    "ALTER TABLE cameras ADD COLUMN detection_zone TEXT",
    // Which detected categories ('person'/'vehicle'/'animal'/'other', JSON
    // string array) actually generate an event - e.g. ignore "animal" to
    // stop pets/wildlife from triggering alerts. NULL/empty = all
    // categories count (unchanged behavior).
    "ALTER TABLE cameras ADD COLUMN detection_categories TEXT",
    // Forces the rotation transcode bridge (media/rotationBridge.ts) to run
    // even when rotation is 0, purely to re-encode a source that's actually
    // H.265/HEVC into H.264 - some clients (older TVs, open-source Chromium
    // builds with no licensed HEVC decoder) can't play HEVC at all. Default
    // 0 (off): unchanged direct pull/relay behavior.
    "ALTER TABLE cameras ADD COLUMN transcode_to_h264 INTEGER NOT NULL DEFAULT 0",
    // Optional downscale applied by that same bridge, to cut ffmpeg's CPU
    // cost on weak hardware. Only has an effect while the bridge is running
    // (rotation != 0 or transcode_to_h264 is on).
    "ALTER TABLE cameras ADD COLUMN transcode_resolution TEXT NOT NULL DEFAULT 'original'",
  ],
  events: [
    "ALTER TABLE events ADD COLUMN read INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE events ADD COLUMN snapshot_path TEXT",
    // Auto-generated caption text from the optional VLM captioning feature
    // (see notifications/captioning.ts) - filled in asynchronously after
    // the event row already exists, same pattern as snapshot_path.
    "ALTER TABLE events ADD COLUMN caption TEXT",
  ],
  grids: [
    // Lets a grid opt out of requireAuth for its viewing endpoints (see
    // db/grids.repository.ts's isCameraInPublicGrid + auth/requireAuth.ts).
    "ALTER TABLE grids ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0",
    // Optional single-stream broadcast (mosaic or rotation) for VLC/smart-TV
    // clients - see media/gridBroadcastBridge.ts + auth/requireAuth.ts's
    // separate HLS bypass for the `grid_<id>` MediaMTX path.
    "ALTER TABLE grids ADD COLUMN broadcast_mode TEXT NOT NULL DEFAULT 'off'",
    "ALTER TABLE grids ADD COLUMN broadcast_interval_seconds INTEGER NOT NULL DEFAULT 10",
  ],
};

function applyColumnMigrations(): void {
  for (const [table, statements] of Object.entries(COLUMN_MIGRATIONS)) {
    const existingColumns = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    );
    for (const statement of statements) {
      const columnName = statement.match(/ADD COLUMN (\w+)/i)?.[1];
      if (columnName && !existingColumns.has(columnName)) {
        db.exec(statement);
      }
    }
  }
}
