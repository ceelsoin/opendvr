import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Runs before each test file's own imports are evaluated. Points every
// filesystem/DB path the app touches at an isolated temp directory instead
// of the real ./data folder, and uses a fresh in-memory SQLite DB per test
// file (Vitest gives each test file its own module registry by default, so
// `db/client.ts`'s module-level `db` singleton is naturally re-created per
// file - no cross-file leakage).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opendvr-test-"));

// A real (but temp, throwaway) file rather than ":memory:": better-sqlite3
// combined with this app's `PRAGMA journal_mode = WAL` setup at import time
// misbehaves with SQLite's special in-memory database ("database is
// locked"), since WAL mode assumes a real file it can create -wal/-shm
// sidecar files next to. A unique temp file per test file (Vitest gives
// each test file its own module registry, so `db/client.ts`'s singleton is
// freshly created per file anyway) is just as isolated and avoids that.
process.env.DB_FILE = path.join(tmpRoot, "test.db");
process.env.DATA_DIR = tmpRoot;
process.env.RECORDINGS_DIR = path.join(tmpRoot, "recordings");
process.env.SNAPSHOTS_DIR = path.join(tmpRoot, "snapshots");
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
