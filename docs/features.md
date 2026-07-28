# Features

## Authentication

- **Setup** (`/setup`): shown automatically instead of the login page whenever no account exists yet (`GET /api/auth/status` → `hasUser: false`). Creates the single admin account (`POST /api/auth/setup`), then signs you straight in.
- **Login** (`/login`): username + password (`POST /api/auth/login`), verified with `bcryptjs` against the stored hash.
- **Sessions**: a JWT stored in an `httpOnly` cookie (`SameSite=Lax`, not readable from JS - mitigates XSS token theft), expiring after **1 hour** by default (`JWT_EXPIRES_IN`, see [Configuration](./configuration.md)). Once it expires, the next API call gets a `401` and the frontend redirects to `/login` automatically (`frontend/src/api/client.ts`'s axios response interceptor).
- **Everything requires a session** except the auth endpoints themselves, `/api/health`, and the static SPA shell under `/web` (just app code, useless without API access) - see `backend/src/auth/requireAuth.ts`. This includes the live HLS proxy (`/hls`), recordings playback proxy (`/recordings`), event snapshots (`/snapshots`), and the WebSocket connection (`backend/src/ws/index.ts` verifies the same cookie on the handshake).
- **Single admin, no roles.** There's exactly one tier of access - no read-only/guest accounts, no per-camera permissions. See [Troubleshooting](./troubleshooting.md#known-limitations) for what this means for the custom-grid kiosk URLs.
- The cookie is **not** marked `Secure` by default, since this app is commonly accessed over plain HTTP on a LAN IP (not a public HTTPS site) - browsers silently refuse to send `Secure` cookies over HTTP, which would break login entirely. Set `COOKIE_SECURE=true` only if you've put this behind a reverse proxy terminating TLS.

## Internationalization (i18n)

- Built on [`react-i18next`](https://react.i18next.com/), with a language switcher in the sidebar (persisted to `localStorage`, defaults to the browser's language if it's English, otherwise Portuguese).
- **Current translation coverage**: the app shell (sidebar nav labels, logout) and the Setup/Login pages are fully translated (`frontend/src/i18n/locales/{pt-BR,en}.json`). The rest of the application's pages (Cameras, Events, Timeline, Settings, etc.) still have their text hardcoded in Portuguese - the i18n infrastructure is in place and ready, but translating every existing page's strings is a larger follow-up task, not yet done.
- To add a string: add the key to both locale JSON files, then use `const { t } = useTranslation()` + `t("your.key")` in the component.

## Camera management

- **LAN discovery** — WS-Discovery probe (`POST /api/discovery`) lists ONVIF devices announcing themselves on the network, with a "use this address" shortcut that pre-fills the add-camera form.
- **Add/edit camera** via a single dialog ([CameraFormDialog](../frontend/src/components/cameras/CameraFormDialog.tsx)):
  - Paste a single ONVIF service URL (`http://user:pass@host:port/path`) **or** fill in host/port/path/credentials separately.
  - "Obter URLs de vídeo" probes the camera (`POST /api/onvif/probe`) and lists every discovered media profile (resolution + codec), letting you pick a **main** (live/record) and **sub** (lower-res) stream. The highest-resolution stream is pre-selected as main, the lowest as sub.
  - Editing keeps the previously selected streams visible without re-probing; the password field is left blank ("leave blank to keep") and simply omitted from the update payload if untouched.
  - Optional **"vlc-relay" compatibility mode** for cameras whose RTSP server doesn't work with MediaMTX's RTSP client (see [Troubleshooting](./troubleshooting.md)).
- **Test connection** — re-probes ONVIF for an already-saved camera and shows the result (streams found, or a detailed connection error) inline.
- **Restart/reprovision** — forces a fresh ONVIF reconnect and MediaMTX path re-registration for a camera, without needing to edit/re-save it.
- **Stream diagnostics** — a "diagnóstico" toggle on each camera tile polls `GET /api/cameras/:id/stream-status` every 3s and shows: whether the MediaMTX path is configured, whether the RTSP source is actually `ready` (connected), source type, reader/viewer count, bytes received, resolved ONVIF/RTSP URLs, and (if applicable) the VLC relay URL. This is the tool to tell apart "ONVIF connected fine but MediaMTX can't pull RTSP" from other failure modes.
- **Delete** — stops any event listener/motion-recording timer/VLC relay, removes the MediaMTX path, then deletes the DB row.

## Live streaming

- Live view over **HLS**, played with `hls.js` (native fallback for Safari), always via the backend's own reverse proxy at `/hls/<cameraId>/index.m3u8` — the browser never talks to MediaMTX directly (no extra CORS/ports to expose).
- Cameras are pulled by MediaMTX with `rtspTransport: tcp` (forced, since UDP tends to fail silently with cheap cameras and containerized/NAT networking) and `sourceOnDemand: false` (always connected — required for continuous recording and for the stream to already be warm when someone opens the live view).
- WebRTC is exposed by MediaMTX (port 8889) but not yet wired up in the frontend player.

## Recording & playback

- Per-camera **recording mode**, one of:
  - `off` — no disk recording.
  - `continuous` — MediaMTX records the whole time (native fMP4 segment recording, no ffmpeg involved).
  - `motion` — recording is toggled on/off reactively based on ONVIF motion events, with a 60s cooldown after the last event before it stops (so brief pauses in activity don't fragment one event into many tiny clips).
- **Timeline page**: pick a camera and a day, see a scrubbable timeline of recorded segments (`RecordingTimeline` component) fetched from MediaMTX's own Playback API (`GET /api/recordings/:cameraId?start=...&end=...`) — there's no separate recordings database to keep in sync, MediaMTX is the source of truth.
- Events that occurred on the selected day are also fetched and can be clicked to jump straight to the matching recorded segment.
- Playback video is served through the backend's `/recordings` reverse proxy to MediaMTX's Playback server — same "browser only talks to the backend" principle as live HLS.
- A `retentionDays` field exists per-camera and is fully enforced: MediaMTX deletes recordings past that age itself (`recordDeleteAfter`, set per-camera on every provision - see [Architecture](./architecture.md)), and a daily backend job deletes event rows + snapshot files past that age too (`backend/src/jobs/retentionCleanup.ts`, runs once at 03:00 and once ~1 minute after boot).

## Motion/tamper events & alerts

- Motion detection source is chosen **per camera**, independent of recording mode: either ONVIF **PullPoint** event subscription (a manual WS-BaseNotification client built on `node-onvif`, see [Architecture](./architecture.md) - no longer depends on the legacy `onvif` package), or local **video analysis** (OpenCV background subtraction on the RTSP stream, `backend/motion_worker.py`) - useful for cameras that advertise ONVIF Events support but don't actually implement it (common on cheap OEM cameras). Either source funnels into the same event pipeline.
- Every event (motion, tamper, line-crossing, intrusion, occupancy — whatever the camera's topic reports, or `video:motion` for the video-based source) is inserted into the database with a `type` and timestamp.
- A JPEG **snapshot** is always attempted per event, served at `/snapshots/<cameraId>/<eventId>.jpg` - tries the camera's ONVIF snapshot first, falling back to grabbing a frame directly from MediaMTX via ffmpeg if that fails, so a snapshot is captured regardless of how broken a camera's ONVIF stack is.
- **Real-time UI**: every event is broadcast over WebSocket (`camera:event`); the frontend shows a toast with a human-friendly translation of the event type (e.g. "Movimento detectado") and flashes a green border around the camera's tile in the grid.
- **Events page**: filter by camera, day, and event type; mark events read/unread; delete individual events.
- **External notifications** (optional, independently configurable from the Settings page or env vars): Discord, Telegram, a generic JSON webhook, and email (SMTP) - each with its own "attach snapshot" toggle. The snapshot is only actually attached when the camera **isn't** recording (`recordingMode: "off"`); when it is recording (`continuous` or `motion`), a link to the Timeline is sent instead of a static image, since the actual clip will be available there.

## PTZ (Pan/Tilt/Zoom)

- Directional continuous-move controls (8-way + stop) via `POST /api/ptz/:id/move` / `/stop`, driven by mouse-down/mouse-up in the UI.
- Presets: list, save (`POST /api/ptz/:id/presets`), and go-to (`POST /api/ptz/:id/presets/:token/goto`).
- Inline expandable panel per camera on the Cameras page, no separate route.

## Custom camera grids (shareable/kiosk URLs)

- Build named grids choosing **which cameras**, **their order**, and the **column count** ("formato").
- Every saved grid gets a **unique, stable URL** at `/g/<gridId>` (or `/web/g/<gridId>` in production) that renders *only* that grid, full-screen, with no sidebar/navigation — meant to be opened permanently on a dedicated device (e.g. a wall-mounted tablet showing just the entryway + garage cameras).
- Managed from the Grid page: create, edit (reorder with ↑/↓, change columns, change camera selection), open in a new tab, copy the URL to the clipboard, or delete.
- This view now requires a logged-in session, same as the rest of the app (see [Troubleshooting](./troubleshooting.md#known-limitations)) — anyone opening the URL without an active session is redirected to `/login`.

## ONVIF debug console

- A terminal-style page (`/onvif-debug`) for running raw ONVIF SOAP operations (`device.info`, `device.capabilities`, `media.profiles`, `ptz.*`, etc. — over 20 commands) against any saved camera, with autocomplete and history. Useful for diagnosing camera compatibility issues without needing an external SOAP client.
- Backed by `GET /api/onvif/debug/commands` (list available commands) and `POST /api/onvif/debug/:cameraId` (execute one, always against the camera's *saved* credentials — never accepts raw credentials from the request body).
- A lower-level SOAP 1.1 vs 1.2 compatibility diagnostic also exists (`POST /api/onvif/diagnose`) but isn't wired to any UI button currently.

## Settings (notifications)

- The **Configurações** page manages all four external notification channels (Discord, Telegram, generic webhook, email/SMTP) at runtime, persisted in the database — no restart needed, and these values take precedence over the env vars in [Configuration](./configuration.md) (which only serve as deploy-time/first-boot defaults).
- Each channel shows a "Configurado"/"Não configurado" badge; secrets (webhook URLs, bot token, SMTP password) are never sent back to the client once saved — leaving a secret field blank on save means "keep the existing value", not "clear it" (clearing is a separate explicit action per channel).
- A **"Testar"** button per channel sends a real test notification immediately using the currently saved configuration, surfacing success/failure inline.
- Backed by `GET`/`PUT /api/settings/notifications` and `POST /api/settings/notifications/test` (see [API Reference](./api-reference.md)).

## Dashboard & system stats

- The **Dashboard** page (`/dashboard`) shows the host's current CPU usage (%, core count, 1/5/15-minute load average), memory usage, and disk usage for both the recordings volume and the app's data volume — each as a color-coded bar (green/amber/red at 70%/90% thresholds), polled every 5s.
- A compact version of the same three metrics is always visible in a slim status bar at the top of every screen (`TopStatusBar`, part of `AppLayout`) — not just the Dashboard page itself — with a hover tooltip for detail and a click-through to the full Dashboard. The kiosk custom-grid view (`/g/:id`) intentionally excludes it, same as the sidebar nav.
- Backed entirely by `GET /api/system/stats` (see [API Reference](./api-reference.md)); no external dependency or configuration needed — CPU/memory come from Node's `os` module, disk usage from `fs.statfs`.

## Known limitations

See [Troubleshooting → Known limitations](./troubleshooting.md#known-limitations) for the full list (single-admin auth with no roles, WebRTC unused by the player, dev-server proxy gaps, etc).
