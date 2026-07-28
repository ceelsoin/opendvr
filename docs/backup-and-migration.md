# Backup & Migration

Everything OpenDVR needs to keep working (camera config, event history, snapshots, recorded footage) lives in two host directories next to `docker-compose.yml`, plus your `.env` file. MediaMTX itself has no persistent state of its own beyond the recordings it writes (see [Architecture](./architecture.md)) - camera path registration is redone from the database on every backend boot.

## What to back up

| Path | Contains | Required? |
|---|---|---|
| `./app-data` | SQLite DB (`ipcam.db` + its `-wal`/`-shm` files) - cameras, events, settings (notification channels, SMTP creds, etc.) - plus event snapshot JPEGs. | **Yes, this is the important one.** Losing it means re-adding every camera from scratch. |
| `./recordings` | Recorded video clips (fMP4 segments), one subfolder per camera ID. | Optional - only if you care about keeping historical footage beyond its retention window. |
| `.env` (repo root, if you created one) | `JWT_SECRET`, notification credentials (`DISCORD_WEBHOOK_URL`, `SMTP_PASS`, etc.) passed to docker-compose. Most of these are also editable from the Settings page and persisted in `app-data/ipcam.db` instead, so this file matters less than it used to - see [Configuration](./configuration.md). | Optional, low-cost to keep anyway. |
| `docker-compose.yml`, `backend/mediamtx.yml` | Deployment/service config. | Only if you've customized them - otherwise they're already in git. |

Both `./app-data` and `./recordings` are plain host bind mounts (gitignored, not committed) - copy/rsync/tar them like any other files. See [Deployment](./deployment.md#volumes) for the exact `docker-compose.yml` mount lines.

## Taking a backup

### Cold backup (recommended - guarantees a consistent DB)

The SQLite DB runs in WAL mode, which means at any given moment there can be uncommitted data sitting in `ipcam.db-wal` rather than `ipcam.db` itself. Copying files while the backend is writing to them risks grabbing an inconsistent snapshot. Stopping the stack first avoids this entirely:

```bash
cd /path/to/opendvr
docker compose stop backend
tar -czf opendvr-backup-$(date +%Y%m%d).tar.gz app-data recordings
docker compose start backend
```

The `mediamtx` service doesn't need to be stopped - it's not what's writing to `app-data`.

### Hot backup (if you don't want any downtime)

`better-sqlite3`'s WAL files are safe to copy as long as you copy all three (`ipcam.db`, `ipcam.db-wal`, `ipcam.db-shm`) atomically relative to each other. A plain `cp -a`/`rsync` of the whole `app-data` directory in one pass is fine in practice (SQLite doesn't rename these files mid-write), but for a guaranteed-consistent copy without stopping anything, use SQLite's own backup command instead:

```bash
docker compose exec backend node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/ipcam.db');
db.backup('/data/ipcam-backup.db').then(() => process.exit(0));
"
docker cp ipcam-backend:/data/ipcam-backup.db ./app-data/ipcam-backup.db
```

Then back up `./app-data/ipcam-backup.db` (a single self-contained, consistent file) instead of the live `ipcam.db`/`-wal`/`-shm` trio. `./recordings` can always be copied hot regardless - MediaMTX only ever appends new segment files, it doesn't rewrite old ones.

## Restoring / migrating to a new host

1. Copy the repository (`git clone` it fresh, or copy your existing working copy) to the new host.
2. Restore `./app-data` and `./recordings` into place at the repo root (extract your tarball, or `rsync` them over).
   - If you used the hot-backup method above, restore `ipcam-backup.db` as `app-data/ipcam.db` (delete any stray `-wal`/`-shm` files next to it first).
3. Restore your `.env` file if you had one (or re-enter notification credentials via the Settings page after boot - they're independent of the DB restore either way, since they're stored *in* `ipcam.db`).
4. `docker compose up -d --build`.
5. Verify: open `/web`, confirm your cameras show up, check the Timeline for existing footage, and check **Configurações** for notification settings.

Camera passwords are stored as plaintext in `ipcam.db` (see [Troubleshooting](./troubleshooting.md#known-limitations) re: no encryption-at-rest) - treat backups of `app-data` with the same care as the live deployment (don't upload them to a public location).

## Migrating from the old named-volume setup

Older versions of this project used named Docker volumes (`ipcam-server_backend-data`, `ipcam-server_recordings`) instead of host bind mounts. If you're still on that setup:

```bash
mkdir -p app-data recordings
docker run --rm -v ipcam-server_backend-data:/from -v "$(pwd)/app-data:/to" alpine cp -a /from/. /to/
docker run --rm -v ipcam-server_recordings:/from -v "$(pwd)/recordings:/to" alpine cp -a /from/. /to/
docker compose up -d
```

Verify cameras/recordings show up correctly, then remove the old named volumes once you're confident:

```bash
docker volume rm ipcam-server_backend-data ipcam-server_recordings
```
