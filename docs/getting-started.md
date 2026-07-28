# Getting Started

## Prerequisites

- **Docker + Docker Compose** (recommended path — handles MediaMTX, ffmpeg, VLC, and native module builds for you), **or**
- For manual/local development: **Node.js 22+**, **npm**, a local or Docker-run **MediaMTX** instance, and **ffmpeg** on your `PATH` (used for snapshots only).

## Option A — Run everything with Docker Compose (recommended)

This is the easiest way to get a fully working stack (backend + frontend + MediaMTX) with a single command.

```bash
git clone <this-repo-url>
cd ipcam-server

# Optional: enable Discord/Telegram notifications (see docs/configuration.md)
# cp .env.example .env   # if you create one; not required to run

docker compose build
docker compose up -d
```

Then open **http://localhost:4000/web/** in your browser.

- `docker compose logs -f backend` / `docker compose logs -f mediamtx` to follow logs.
- `docker compose down` to stop (add `-v` to also drop the named volumes, i.e. wipe the database and recordings).

See [Deployment](./deployment.md) for a full breakdown of services, ports, and volumes.

## Option B — Manual local development (hot reload for both frontend and backend)

Useful when actively developing the app itself.

### 1. Start MediaMTX

Either run it via Docker on its own:
```bash
docker run --rm -it \
  -p 8554:8554 -p 8888:8888 -p 8889:8889 -p 9997:9997 -p 9996:9996 \
  -v "$(pwd)/backend/mediamtx.yml:/mediamtx.yml:ro" \
  bluenviron/mediamtx:latest
```
or download a binary from the [MediaMTX releases page](https://github.com/bluenviron/mediamtx/releases) and run `./mediamtx backend/mediamtx.yml`.

> When running MediaMTX this way (all ports on `127.0.0.1`), the `authInternalUsers: any` rule in `mediamtx.yml` is not even required for `api`/`metrics` access from the backend, since both are on localhost — but it's harmless either way.

### 2. Configure and start the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` — the example file is minimal, so at least add the vars it's missing if you need them (recordings dir, snapshots dir, playback URL, VLC relay settings). See the full table in [Configuration](./configuration.md). A complete local `.env` looks like:

```env
PORT=4000
NODE_ENV=development

JWT_SECRET=dev-secret-change-me
JWT_EXPIRES_IN=7d

DATA_DIR=./data
RECORDINGS_DIR=./data/recordings
SNAPSHOTS_DIR=./data/snapshots
DB_FILE=./data/ipcam.db

FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe

MEDIAMTX_API_URL=http://127.0.0.1:9997
MEDIAMTX_RTSP_URL=rtsp://127.0.0.1:8554
MEDIAMTX_HLS_URL=http://127.0.0.1:8888
MEDIAMTX_PLAYBACK_URL=http://127.0.0.1:9996

VLC_PATH=cvlc
VLC_RELAY_HOST=127.0.0.1
VLC_RELAY_PORT_START=9500
```

Then:
```bash
npm install
npm run dev
```
The backend starts on **http://localhost:4000** (via `tsx watch`, auto-restarting on changes). It runs its DB migrations automatically on boot.

### 3. Start the frontend

In a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173**. Vite proxies `/api`, `/socket.io`, and `/hls` to the backend on port 4000 (see [Configuration](./configuration.md) for what's *not* proxied in this mode).

## Adding your first camera

1. Go to **Câmeras** in the sidebar.
2. Click **"Descobrir câmeras (ONVIF)"** to scan the LAN, or click **"Adicionar câmera"** directly if you already know its address.
3. Paste the camera's ONVIF URL (e.g. `http://admin:password@192.168.1.50:80/onvif/device_service`) or fill in the fields manually, then click **"Obter URLs de vídeo"**.
4. Pick the main/live stream and (optionally) a lower-res sub-stream from the dropdowns, name the camera, choose a recording mode, and save.
5. Go to **Grid** — the camera should appear and start playing live (it may take a few seconds for MediaMTX to establish the RTSP connection). Click **"diagnóstico"** on the tile if it doesn't come up, to see exactly where the connection is stuck (see [Troubleshooting](./troubleshooting.md)).

## Building for production

See [Deployment](./deployment.md#building-the-docker-image) for the Docker path, or [Development](./development.md#build--typecheck) for building the backend/frontend manually without Docker.
