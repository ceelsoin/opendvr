# Development

## Repository layout

```
backend/                  Node.js + TypeScript + Express API
  src/
    index.ts              Entry point: migrations, HTTP+WS server, boot-time provisioning, reconciliation loop
    app.ts                Express app: /api mount, /hls + /recordings proxies, /snapshots + /web static
    api/routes/            One router per resource (cameras, discovery, onvif, ptz, recordings, events, grids, settings, system)
    config/env.ts         All environment variable parsing, in one place
    db/                   better-sqlite3 client + migrations + one repository module per table
    jobs/                  Scheduled jobs (retentionCleanup.ts - deletes old events/snapshots daily)
    lib/                  Small standalone helpers (errors, logger, retry, rtsp, tcpCheck, onvifUri, snapshotStorage, systemStats)
    media/                MediaMTX client, provisioning, VLC relay, motion-triggered recording, ffmpeg recorder
    notifications/        Discord/Telegram/generic-webhook/email senders + persisted settings (notificationSettings.ts)
    onvif/                 Device connection, discovery, PTZ, events, debug console, SOAP diagnostics
    types/                 Shared TypeScript types + ambient declarations for untyped packages (onvif, node-onvif)
    ws/                    Socket.IO setup + emit helpers
  scripts/                 Standalone dev/debug scripts (see below), + build-frontend.js used by `npm run build`
  mediamtx.yml             MediaMTX config (see docs/configuration.md)
  Dockerfile               Multi-stage build (see docs/deployment.md)

frontend/                 Vite + React 19 + TypeScript SPA
  src/
    App.tsx               Route table
    api/                  One React Query hook module per backend resource + axios client + socket.io client
    components/            cameras/, grids/, layout/ (incl. TopStatusBar), player/, ptz/, realtime/, timeline/, ui/
    pages/                 GridPage, CustomGridViewPage, TimelinePage, EventsPage, CamerasPage, OnvifDebugPage, SettingsPage, DashboardPage
    store/                 zustand stores (toasts, UI state, camera-event-flash state)

docker-compose.yml         Two services: mediamtx + backend (build context = repo root)
docs/                      You are here
```

## Scripts

### Backend (`backend/package.json`)

| Script | What it does |
|---|---|
| `npm run dev` | `tsx watch src/index.ts` — runs the backend with auto-restart on file changes. Runs migrations on every start. |
| `npm run build` | `build:backend` (tsc) **then** `build:frontend` — always regenerates the frontend build too. |
| `npm run build:backend` | `tsc -p tsconfig.json` → `dist/`. |
| `npm run build:frontend` | Runs `scripts/build-frontend.js`, which runs `npm run build` inside `frontend/` and copies `frontend/dist` → `backend/dist/web`. |
| `npm start` | `node dist/index.js` — run the already-built backend (production). |
| `npm test` | Placeholder — **no automated tests exist yet**. |

Typecheck without emitting: `npx tsc --noEmit -p tsconfig.json`.

### Frontend (`frontend/package.json`)

| Script | What it does |
|---|---|
| `npm run dev` / `npm start` | `vite` — dev server on port 5173 with hot reload (both are aliases of the same command). |
| `npm run build` | `tsc -b && vite build` — typechecks (project references) and produces `frontend/dist`. |
| `npm run lint` | `oxlint` — the project uses [Oxlint](https://oxc.rs/docs/guide/usage/linter.html), not ESLint. |
| `npm run preview` | Serves the production build locally for a quick smoke test. |

## Standalone helper scripts (`backend/scripts/`)

These are one-off diagnostic tools, not part of the app's runtime — handy when debugging a specific camera without spinning up the whole stack:

- `test-onvif-isolated.js` — connects to a real camera with both the `onvif` and `node-onvif` packages side by side and reports which one works. Usage: `node scripts/test-onvif-isolated.js <host> <port> <path> <user> <pass>`.
- `test-rtsp-isolated.js` — isolates RTSP-layer connectivity issues from ONVIF ones.
- `rtsp-proxy-logger.js` — a logging TCP proxy for inspecting raw RTSP traffic between MediaMTX/VLC and a camera.
- `vlc-relay-test/` — a standalone Dockerfile + `run.sh` to test the VLC RTSP-relay approach against a real camera outside the main stack.
- `build-frontend.js` — **not** a diagnostic tool; this one *is* part of the real build (`npm run build:frontend`, see above).

## TypeScript conventions

- Backend uses **TypeScript 7** (`typescript@^7`) — note that `tsconfig.json`'s `baseUrl` option was removed in TS7; use `paths` with an explicit `./` prefix instead if you need path aliases.
- Packages without published types (`onvif`, `node-onvif`) have hand-written ambient module declarations in `backend/src/types/*.d.ts` — extend those if you use more of either package's surface.
- No ORM: all SQL is written by hand against `better-sqlite3` (synchronous API). Migrations are a plain ordered array of `CREATE TABLE IF NOT EXISTS ...` statements in `db/client.ts`, plus a small `applyColumnMigrations()` step for additive columns (checks `PRAGMA table_info` first, since SQLite has no `ADD COLUMN IF NOT EXISTS`).

## Testing

There is currently **no automated test suite** for either backend or frontend (`backend`'s `npm test` is a placeholder). Manual verification relies on:
- `npx tsc --noEmit` / `npm run build` for type safety.
- The standalone scripts above for real-camera ONVIF/RTSP behavior (since that can't be meaningfully mocked without a real device).
- Manual exercising of the UI + `docker compose logs` for integration-level checks (MediaMTX path registration, HLS proxy, etc).

If you're contributing, consider adding tests for pure logic (e.g. `lib/onvifUri.ts`, `lib/rtsp.ts`, `db/*.repository.ts`) as a good first step — none of these require a real camera or Docker to test.

## Security notes worth knowing before you touch dependencies

- `react-router-dom` is intentionally kept at its latest major (7.18.1+) despite an `npm audit` advisory about CSRF in "RSC Mode" — that mode (React Server Components/framework mode) isn't used here (this is a plain client-side SPA), so it doesn't apply. **Do not run `npm audit fix --force`** on it; that forces a downgrade to a much older version with worse, real vulnerabilities.
