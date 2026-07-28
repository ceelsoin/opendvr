# Deployment (Docker / docker-compose)

## Services

[docker-compose.yml](../docker-compose.yml) defines two services:

| Service | Image | Purpose |
|---|---|---|
| `mediamtx` | `bluenviron/mediamtx:latest` (official) | RTSP ingestion, HLS/WebRTC republishing, native recording. |
| `backend` | built from `backend/Dockerfile` (context = repo root) | Express API + Socket.IO + serves the built frontend under `/web`. |

## Ports

| Port | Service | Published to host? | Purpose |
|---|---|---|---|
| `4000` | backend | ✅ | HTTP API + web UI (`/web`) + WS. |
| `9500-9510` | backend | ✅ | VLC RTSP-compatibility relay processes — only needs to be reachable by MediaMTX internally; published mainly so you can manually test a relay URL directly (e.g. open `rtsp://localhost:9500/relay` in VLC). |
| `8554` | mediamtx | ✅ | RTSP — handy for testing a camera's feed directly with VLC/ffplay. |
| `8889` | mediamtx | ✅ | WebRTC (not consumed by the frontend player yet). |
| `8888` (HLS) | mediamtx | ❌ | Deliberately **not** published — the frontend only ever talks to the backend's `/hls` reverse proxy. |
| `9997` (Control API) | mediamtx | ❌ | Administrative; internal Docker network only. **Do not publish this.** |
| `9996` (Playback API) | mediamtx | ❌ | Administrative; internal Docker network only. **Do not publish this.** |

## Volumes

| Host path | Mounted at | Purpose |
|---|---|---|
| `./app-data` | `/data` in `backend` | SQLite DB (`ipcam.db`) + event snapshots. |
| `./recordings` | `/recordings` in both `mediamtx` and `backend` | Shared: MediaMTX writes recordings here; the backend reads them back for size/listing purposes if needed. |

Both are plain **host bind mounts** (not named Docker volumes) — the actual files live directly under the repo root at `./app-data` and `./recordings`, browsable/copyable from the host without going through `docker exec`/`docker cp`. Both are gitignored (see root [`.gitignore`](../.gitignore)). See [Backup & Migration](./backup-and-migration.md) for how to back these up safely (SQLite WAL caveats included) and how to migrate from the older named-volume setup.

## Building the Docker image

```bash
docker compose build backend
# or, to also pull the latest MediaMTX image:
docker compose build
docker compose up -d
```

### How the image is built ([backend/Dockerfile](../backend/Dockerfile))

Multi-stage build, with the **build context set to the repo root** (`context: .` in docker-compose.yml) so it can access both `frontend/` and `backend/`:

1. **`frontend-build`** (`node:22-slim`) — `npm install` (not `npm ci`: the lockfile was generated on macOS and doesn't fully pin some optional native/WASM fallback packages for other platforms that `npm ci` is strict about) → `npm run build` → produces `frontend/dist`.
2. **`backend-build`** (`node:22-alpine`) — installs `python3 make g++` (needed to compile `better-sqlite3`'s native addon from source; Alpine/musl has no compatible prebuilt binary) → `npm ci` → `tsc` build → `npm prune --omit=dev`.
3. **`runtime`** (`node:22-alpine`) — installs `ffmpeg` (snapshots) and `vlc` (RTSP compatibility relay; Alpine's VLC package links against a real `live555`, unlike Debian/Ubuntu's, for licensing reasons) → copies `node_modules` + `dist` from `backend-build` and `frontend/dist` into `dist/web` from `frontend-build` → creates an unprivileged `vlcrelay` user (VLC refuses to run as root; the rest of the app still runs as root) → `CMD ["node", "dist/index.js"]`.

**Why Alpine and not Debian slim for the backend?** `better-sqlite3`'s prebuilt binaries are glibc-linked and require a newer glibc than Debian 12 ships, causing `ERR_DLOPEN_FAILED` at runtime. Alpine (musl) doesn't have this problem, and the build stage compiles it from source there anyway.

## Updating

```bash
git pull
docker compose build
docker compose up -d
```
The backend re-runs its migrations and re-provisions every stored camera automatically on boot — no manual DB/camera steps needed after an update.

## Running behind a reverse proxy / exposing to the internet

There is **no built-in authentication**. If you need to access this outside your LAN, put it behind a reverse proxy (Caddy, Traefik, nginx) that adds its own authentication (Basic Auth, OAuth2 Proxy, etc.) in front of port `4000` — do not expose it directly. See [Configuration](./configuration.md) for the (currently unused) `JWT_SECRET` variable, reserved for a future built-in auth layer.
