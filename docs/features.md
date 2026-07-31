# Features

## Authentication

- **Setup** (`/setup`): shown automatically instead of the login page whenever no account exists yet (`GET /api/auth/status` → `hasUser: false`). Creates the single admin account (`POST /api/auth/setup`), then signs you straight in.
- **Login** (`/login`): username + password (`POST /api/auth/login`), verified with `bcryptjs` against the stored hash.
- **Sessions**: a JWT stored in an `httpOnly` cookie (`SameSite=Lax`, not readable from JS - mitigates XSS token theft), expiring after **1 hour** by default (`JWT_EXPIRES_IN`, see [Configuration](./configuration.md)). Once it expires, the next API call gets a `401` and the frontend redirects to `/login` automatically (`frontend/src/api/client.ts`'s axios response interceptor).
- **Everything requires a session** except the auth endpoints themselves, `/api/health`, and the static SPA shell under `/web` (just app code, useless without API access) - see `backend/src/auth/requireAuth.ts`. This includes the live HLS proxy (`/hls`), recordings playback proxy (`/recordings`), event snapshots (`/snapshots`), and the WebSocket connection (`backend/src/ws/index.ts` verifies the same cookie on the handshake).
- **Single admin, no roles.** There's exactly one tier of access - no read-only/guest accounts, no per-camera permissions. See [Troubleshooting](./troubleshooting.md#known-limitations) for what this means for the custom-grid kiosk URLs.
- The cookie is **not** marked `Secure` by default, since this app is commonly accessed over plain HTTP on a LAN IP (not a public HTTPS site) - browsers silently refuse to send `Secure` cookies over HTTP, which would break login entirely. Set `COOKIE_SECURE=true` only if you've put this behind a reverse proxy terminating TLS.

## Internationalization (i18n)

- Built on [`react-i18next`](https://react.i18next.com/), with a language switcher in the sidebar (persisted to `localStorage`). Detects the browser's language on first visit (`navigator.languages`, matched against the primary language subtag - e.g. `es-MX` → Spanish, `zh-Hans-CN` → Chinese), falling back to Portuguese if none of the supported languages match.
- **12 languages**: Portuguese (`pt-BR`) and English, plus the ten languages covering the largest populations that predominantly don't speak English - Spanish, French, German, Chinese (`zh-CN`), Japanese, Korean, Russian, Arabic, Hindi, and Indonesian (`frontend/src/i18n/locales/*.json`).
- **Arabic reads right-to-left**: `<html dir>` is set to `rtl`/`ltr` automatically based on the selected language (`frontend/src/i18n/index.ts`'s `RTL_LANGUAGES`), so at least text alignment/reading order is correct. Full RTL-mirrored layout (flipping the sidebar, icons, etc.) is **not** implemented - that would need every Tailwind flex/grid layout in the app reviewed for RTL-awareness, a larger follow-up task.
- **Current translation coverage**: the app shell (sidebar nav labels, logout) and the Setup/Login pages are fully translated in all 12 languages. The rest of the application's pages (Cameras, Events, Timeline, Settings, etc.) still have their text hardcoded in Portuguese - the i18n infrastructure is in place and ready, but translating every existing page's strings is a larger follow-up task, not yet done.
- To add a string: add the key to **every** locale JSON file under `frontend/src/i18n/locales/`, then use `const { t } = useTranslation()` + `t("your.key")` in the component.

## Camera management

- **LAN discovery** — WS-Discovery probe (`POST /api/discovery`) lists ONVIF devices announcing themselves on the network, with a "use this address" shortcut that pre-fills the add-camera form. For devices that don't announce themselves (WS-Discovery disabled/blocked), an **active network scan** (`POST /api/discovery/scan`) probes a given IP range/CIDR for open ONVIF/RTSP ports instead, streaming progress as a live terminal-style log (newline-delimited JSON) instead of waiting for the whole range to finish.
- **Camera sources** — not just ONVIF. Each camera has a `sourceType`:
  - `onvif` (default) — the full flow below (probe, PTZ, ONVIF motion events, ONVIF snapshot).
  - `rtsp` / `rtmp` / `hls` / `srt` — a directly-entered stream URL of that protocol, pulled by MediaMTX natively with no transcoding bridge. Optionally still uses the ONVIF host/port/path/credentials fields purely for PTZ control if `hasPtz` is checked, even though the video itself bypasses ONVIF entirely.
  - `mjpeg-http` — an MJPEG-over-HTTP camera (older/cheap webcams); bridged into an RTSP source MediaMTX can consume via an ffmpeg re-encode (`backend/src/media/mjpegBridge.ts`).
  - `webpage` — an arbitrary web page rendered by a headless Chromium and captured as a video feed (`backend/src/media/webpageBridge.ts`) — useful for cameras that only expose a web viewer with no direct stream URL. By far the heaviest source type (runs a real browser engine per camera).
  - For any non-`onvif` source, motion detection is always the local video-based analyzer (no ONVIF Events subscription exists for a directly-entered stream), and event snapshots always come from the ffmpeg/MediaMTX frame-grab fallback rather than ONVIF's `GetSnapshotUri`.
- **Video rotation** — `rotation: 0 | 90 | 180 | 270` (clockwise), for cameras mounted sideways/upside down. `0` is a pure passthrough; any other value forces a small ffmpeg transcode bridge (`backend/src/media/rotationBridge.ts` for onvif/rtsp/rtmp/hls/srt sources, or the rotation filter added directly to the existing bridge for mjpeg-http/webpage) since MediaMTX itself has no video-filter capability.
- **Transcode to H.264** — per-camera opt-in for cameras whose actual video is H.265/HEVC, which some clients (e.g. open-source Chromium builds, which have no licensed HEVC decoder regardless of hardware) can't play at all. Reuses the same ffmpeg bridge as video rotation (`backend/src/media/rotationBridge.ts`), so it's also forced on whenever rotation is non-zero. An optional resolution downscale (`720`/`480`/`360`, keeping aspect ratio) can be combined with it to reduce the CPU cost of software re-encoding on weak/no-GPU hardware.
- **Add/edit camera** via a single dialog ([CameraFormDialog](../frontend/src/components/cameras/CameraFormDialog.tsx)):
  - Paste a single ONVIF service URL (`http://user:pass@host:port/path`) **or** fill in host/port/path/credentials separately — or pick a direct source type above and just paste the stream URL.
  - "Obter URLs de vídeo" probes the camera (`POST /api/onvif/probe`) and lists every discovered media profile (resolution + codec), letting you pick a **main** (live/record) and **sub** (lower-res) stream. The highest-resolution stream is pre-selected as main, the lowest as sub.
  - **Editing reuses the already-saved password automatically**: since passwords are never sent back to the client, re-probing while editing (to see all available streams again, not just the main/sub picked last time) used to require retyping it. Now, if you leave the password field blank, "Obter URLs de vídeo" calls a camera-scoped endpoint (`POST /api/cameras/:id/probe`) that falls back to the stored password for any field you didn't change — only creating a new camera, or deliberately typing a different password, requires entering one explicitly.
  - Optional **"vlc-relay" compatibility mode** for cameras whose RTSP server doesn't work with MediaMTX's RTSP client (see [Troubleshooting](./troubleshooting.md)).
- **Test connection** — re-probes ONVIF for an already-saved camera and shows the result (streams found, or a detailed connection error) inline.
- **Restart/reprovision** — forces a fresh ONVIF reconnect and MediaMTX path re-registration for a camera, without needing to edit/re-save it.
- **Enable/disable** (`POST /api/cameras/:id/enable` / `/disable`) — an administrative on/off switch distinct from the connectivity-based `status` field: disabling tears down the camera's MediaMTX path, motion listener/detector, motion-recording timer, and VLC relay, but keeps its row/config in the database so it can be re-enabled later without re-entering anything. Disabled cameras are skipped entirely on backend boot and by the periodic MediaMTX-path reconciliation loop, so they won't be silently re-provisioned. Available from the **Câmeras** page and from each camera tile's context menu.
- **Stream diagnostics** — a "diagnóstico" toggle on each camera tile polls `GET /api/cameras/:id/stream-status` every 3s and shows: whether the MediaMTX path is configured, whether the RTSP source is actually `ready` (connected), source type, reader/viewer count, bytes received, resolved ONVIF/RTSP URLs, and (if applicable) the VLC relay URL. This is the tool to tell apart "ONVIF connected fine but MediaMTX can't pull RTSP" from other failure modes.
- **Delete** — stops any event listener/motion-recording timer/VLC relay, removes the MediaMTX path, then deletes the DB row.

## Live streaming

- Live view over **HLS**, played with `hls.js` (native fallback for Safari), always via the backend's own reverse proxy at `/hls/<cameraId>/index.m3u8` — the browser never talks to MediaMTX directly (no extra CORS/ports to expose).
- Cameras are pulled by MediaMTX with `rtspTransport: tcp` (forced, since UDP tends to fail silently with cheap cameras and containerized/NAT networking) and `sourceOnDemand: false` (always connected — required for continuous recording and for the stream to already be warm when someone opens the live view). Direct sources (`rtmp`/`hls`/`srt`) and the ffmpeg/Chromium bridges (`mjpeg-http`/`webpage`) use MediaMTX's `publisher` source mode instead — see [Camera management](#camera-management) and [Architecture](./architecture.md).
- WebRTC is exposed by MediaMTX (port 8889) but not yet wired up in the frontend player.
- **Fullscreen per camera** — a corner button (visible on hover) on each camera tile, and a "Tela cheia" item in the context menu, requests fullscreen for just that camera's tile (`Element.requestFullscreen()`), independent of the browser's own fullscreen shortcut.
- **Refresh video** — a refresh icon next to the fullscreen button (and a matching context-menu item) remounts just that tile's HLS player, tearing down and recreating the underlying `hls.js` instance. Useful when a single tile gets stuck (e.g. after a brief network blip) without needing to reload the entire page.
- **Context menu on each camera tile** ([CameraTile](../frontend/src/components/cameras/CameraTile.tsx)) — right-click anywhere on a tile, or tap the always-visible "⋮" button in its top-left corner (the mobile-friendly equivalent, since touch devices have no right-click/contextmenu gesture): Tela cheia, Atualizar vídeo, Ligar/Desligar, Reiniciar, Testar conexão, and Editar câmera — all without navigating to the **Câmeras** management page.
- **"Fit all cameras on screen" grid mode** — a toggle on the **Grid** page (persisted to `localStorage`) that lays out every camera tile so the entire grid fits within the viewport height with no scrolling, instead of a fixed column count with `aspect-video` tiles that can overflow off-screen once you have many cameras. `frontend/src/lib/useFitGrid.ts` brute-forces every possible column count (1..N), computes the resulting tile size for each (respecting the 16:9 aspect ratio, tile gaps, and the name/status footer height), and picks whichever column count yields the largest tiles that still fit the available height — recomputed on window/container resize.

## Recording & playback

- Per-camera **recording mode**, one of:
  - `off` — no disk recording.
  - `continuous` — MediaMTX records the whole time (native fMP4 segment recording, no ffmpeg involved).
  - `motion` — recording is toggled on/off reactively based on motion events (ONVIF or video-based, see below), with a 60s cooldown after the last event before it stops (so brief pauses in activity don't fragment one event into many tiny clips).
- **Multi-camera Timeline**: pick a day and add as many cameras as you want (a dropdown lists the ones not already shown; the last-viewed set is remembered per browser). Each camera gets its own **player tile** in a grid at the top, and its own scrubbable **timeline row** stacked below, all sharing the same time axis so you can compare footage across cameras side by side.
  - Segments come straight from MediaMTX's own Playback API (`GET /api/recordings/:cameraId?start=...&end=...`) — there's no separate recordings database to keep in sync.
  - **Live playback marker**: each timeline row shows a vertical marker that tracks that camera's current playback position in real time as its clip plays.
  - **Hover time badge**: moving the pointer over a timeline row shows the exact clock time under the cursor.
  - **Continuous playback across gaps**: when a clip finishes, the player automatically advances to the next recorded segment for that camera (even across a gap with no recording) instead of just stopping — playback only actually stops when there's genuinely nothing left to play for the rest of the day.
  - Events that occurred on the selected day are also fetched and can be clicked to jump straight to the matching recorded segment.
  - **Export/download a clip**: after selecting a range (click-drag on a timeline row), set a pre-roll and duration, and each camera's tile offers a direct download link for that exact clip (served as a single non-fragmented MP4 via MediaMTX's Playback API, not the fMP4 segments used for live scrubbing). A **"download all"** button downloads every visible camera's clip for the current selection, staggering the requests slightly so the browser doesn't choke on several simultaneous downloads.
- Playback video is served through the backend's `/recordings` reverse proxy to MediaMTX's Playback server — same "browser only talks to the backend" principle as live HLS.
- A `retentionDays` field exists per-camera and is fully enforced: MediaMTX deletes recordings past that age itself (`recordDeleteAfter`, set per-camera on every provision - see [Architecture](./architecture.md)), and a daily backend job deletes event rows + snapshot files past that age too (`backend/src/jobs/retentionCleanup.ts`, runs once at 03:00 and once ~1 minute after boot).

## Motion/tamper events & alerts

- Motion detection source is chosen **per camera**, independent of recording mode: either ONVIF **PullPoint** event subscription (a manual WS-BaseNotification client built on `node-onvif`, see [Architecture](./architecture.md) - no longer depends on the legacy `onvif` package), or local **video analysis** (OpenCV background subtraction on the RTSP stream, `backend/motion_worker.py`) - useful for cameras that advertise ONVIF Events support but don't actually implement it (common on cheap OEM cameras). Either source funnels into the same event pipeline.
- Every event (motion, tamper, line-crossing, intrusion, occupancy — whatever the camera's topic reports, or `video:motion` for the video-based source) is inserted into the database with a `type` and timestamp.
- A JPEG **snapshot** is always attempted per event, served at `/snapshots/<cameraId>/<eventId>.jpg` - tries the camera's ONVIF snapshot first, falling back to grabbing a frame directly from MediaMTX via ffmpeg if that fails, so a snapshot is captured regardless of how broken a camera's ONVIF stack is.
- **Real-time UI**: every event is broadcast over WebSocket (`camera:event`); the frontend shows a toast with a human-friendly translation of the event type (e.g. "Movimento detectado") and flashes a green border around the camera's tile in the grid.
- **Events page**: filter by camera, day, and event type; mark events read/unread; delete individual events.
- **External notifications** (optional, independently configurable from the Settings page or env vars): Discord, Telegram, a generic JSON webhook, email (SMTP), and **browser/PWA push notifications** - each with its own toggle. Discord/Telegram/webhook/email each have an "attach snapshot" toggle: the snapshot is only actually attached when the camera **isn't** recording (`recordingMode: "off"`); when it is recording (`continuous` or `motion`), a link to the Timeline is sent instead of a static image, since the actual clip will be available there. Push notifications include that same link/snapshot as the notification's click-through URL and icon.
- **Camera connectivity notifications**: separate from motion/tamper alerts, a camera that stays unavailable (MediaMTX path not `ready`, or `ready` but with no new bytes flowing - e.g. a wedged VLC relay) for **10 minutes straight** triggers an "unavailable" notification through the same channels above, repeated every **hour** for as long as it stays down, so a prolonged outage doesn't go unnoticed after the first alert. A matching "back online" notification (with total downtime) fires once it recovers - but only if an "unavailable" notification was actually sent first, so brief blips under the 10-minute threshold don't also spam a "recovered" message. This is independent of, and on top of, the background reconciliation loop that's already trying to fix the camera automatically (see [Architecture](./architecture.md#self-healing-reconciliation-loop)).

## AI computer vision (object detection, zones, face recognition, auto-captioning)

Opt-in, per-camera features layered on top of the existing video motion detector, designed to run on modest (dual/quad-core, no GPU) hardware - see [Configuration → AI computer vision](./configuration.md#ai-computer-vision-object-detection-face-recognition-auto-captioning) for model setup instructions.

- **Object detection** (camera form checkbox): a YOLO (nano) model, run via OpenCV's own `dnn` module in a single shared process for the whole app (`backend/vision_worker.py`), classifies each frame the existing OpenCV motion detector already flagged as moving - it never runs continuously, only on already-triggered frames. Detections are grouped into `person`/`vehicle`/`animal`/`other`, turning the previous generic "motion detected" event into a specific one (and suppressing frames where nothing recognizable was found - fewer false positives from shadows/wind/compression noise). A per-category checkbox (camera form) lets you opt specific categories out of triggering an event at all - e.g. ignore `animal` to stop pets/wildlife from generating alerts.
- **Zone of interest**: an optional polygon, drawn over a live camera snapshot (camera form → "Definir zona de interesse"), that restricts which detections count - e.g. ignoring a public sidewalk visible through a gate. Applies to every video-based detection method: the plain OpenCV motion detector itself, object detection, and face recognition alike.
- **Face recognition** (camera form checkbox, requires object detection): whenever a `person` is detected, OpenCV's YuNet (detection) + SFace (embedding) models identify faces and match them against a **Faces** page (`/faces`) of enrolled photos, via cosine similarity - event metadata records whether a detected face matched a known one.
- **Auto-captioning** (Settings page, global): for notable object-detection events, generates a short caption per category (person/vehicle/animal/other), independently toggleable. Three provider modes: **External** (any OpenAI-compatible vision endpoint you configure - hosted API, remote Ollama/LM Studio), **CPU**, or **GPU** (the optional `llamacpp-cpu`/`llamacpp-gpu` docker-compose sidecar services - official prebuilt llama.cpp images running the bundled SmolVLM-500M GGUF model, pre-wired to fixed endpoints - nothing to fill in). The caption is stored on the event and appended to external notifications. See [Configuration → AI computer vision](./configuration.md#ai-computer-vision-object-detection-face-recognition-auto-captioning) for setup.
- All four are entirely optional and disabled by default; missing model files or a misconfigured captioning endpoint simply disable that specific capability without affecting anything else (including plain motion detection, which keeps working exactly as before).

## PTZ (Pan/Tilt/Zoom)

- Directional continuous-move controls (8-way + stop) via `POST /api/ptz/:id/move` / `/stop`, driven by mouse-down/mouse-up in the UI.
- Presets: list, save (`POST /api/ptz/:id/presets`), and go-to (`POST /api/ptz/:id/presets/:token/goto`).
- Inline expandable panel per camera on the Cameras page, no separate route.
- Available even for non-ONVIF direct sources (`rtsp`/`rtmp`/`hls`/`srt`) if `hasPtz` is checked on the camera - PTZ commands still go over ONVIF using that camera's host/port/path/credentials fields, independent of where the video itself comes from.

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

- The **Configurações** page manages all five external notification channels (Discord, Telegram, generic webhook, email/SMTP, and push) at runtime, persisted in the database — no restart needed, and these values take precedence over the env vars in [Configuration](./configuration.md) (which only serve as deploy-time/first-boot defaults).
- Each channel shows a "Configurado"/"Não configurado" badge; secrets (webhook URLs, bot token, SMTP password) are never sent back to the client once saved — leaving a secret field blank on save means "keep the existing value", not "clear it" (clearing is a separate explicit action per channel).
- A **"Testar"** button per channel sends a real test notification immediately using the currently saved configuration, surfacing success/failure inline.
- Backed by `GET`/`PUT /api/settings/notifications` and `POST /api/settings/notifications/test` (see [API Reference](./api-reference.md)).

## Push notifications (PWA)

- OpenDVR can send **Web Push** notifications straight to a browser or an installed PWA (Chrome/Edge/Firefox on desktop and Android; Safari on iOS/iPadOS 16.4+ requires "Add to Home Screen" first) - the same motion/tamper alerts that already trigger Discord/Telegram/email/webhook, delivered as a native OS notification even with the tab/app closed.
- Enabled per browser/device from the **Configurações** page, under "Notificações push (PWA)": clicking "Ativar neste dispositivo" requests notification permission and registers a subscription; "Desativar neste dispositivo" revokes it. No external account/service is required - unlike Discord/Telegram/email, this needs zero configuration to turn on.
- Under the hood: `frontend/public/sw.js` is a minimal service worker (registered in `main.tsx`, no offline caching - this app has no use for that) that listens for `push` (shows the notification) and `notificationclick` (focuses an open tab or opens one at the event's Timeline link). The backend identifies itself to browsers' push services with a VAPID key pair, generated automatically on first use and persisted in the database (`backend/src/lib/webPush.ts`) - no manual key-generation step needed, though `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env vars can pin a specific pair if you need one (see [Configuration](./configuration.md)).
- Requires HTTPS in production (the Push API is unavailable on plain HTTP except on `localhost`) - see [Configuration](./configuration.md) for reverse-proxy/TLS notes.
- Backed by `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, and the same `POST /api/settings/notifications/test` used by the other channels (`channel: "push"`) - see [API Reference](./api-reference.md).

## Dashboard & system stats

- A compact CPU/memory/disk summary is always visible in a slim status bar at the top of every screen (`TopStatusBar`, part of `AppLayout`) — current CPU usage (%, core count, 1/5/15-minute load average), memory usage, and disk usage for both the recordings volume and the app's data volume, each color-coded (green/amber/red at 70%/90% thresholds), polled every 5s, with a hover tooltip for detail. The kiosk custom-grid view (`/g/:id`) intentionally excludes it, same as the sidebar nav.
- A dedicated **Dashboard** page (`frontend/src/pages/DashboardPage.tsx`) with the same three metrics as full-size cards exists in the codebase but its route (`/dashboard`) is currently commented out in `App.tsx`/left out of the sidebar nav, since the always-visible `TopStatusBar` above covers the same information on every screen already — re-enable the route if you want the larger dedicated view back.
- Backed entirely by `GET /api/system/stats` (see [API Reference](./api-reference.md)); no external dependency or configuration needed — CPU/memory come from Node's `os` module, disk usage from `fs.statfs`.

## Maintenance

The **Maintenance** page (`/maintenance`) groups administrative actions that don't fit the per-camera pages:

- **Change password** — requires the current password (defense in depth beyond the session cookie) plus a new one (8+ characters), confirmed twice in the form. `POST /api/maintenance/change-password`.
- **View logs** — a live-tailing log viewer (`GET /api/maintenance/logs`, polled with an increasing `afterSeq` cursor) reading from an in-memory ring buffer of recent backend log entries, optionally filtered by camera. The same endpoint also backs the per-camera log modals shown from the Cameras page while restarting/testing a connection.
- **Delete recordings** — wipes recorded video files from disk for one specific camera or every camera at once (`POST /api/maintenance/recordings/delete`); confirmed with a dialog first. This only touches files on disk (MediaMTX manages recordings natively, there's no separate DB table to clean up).
- **Restart server** — restarts the whole backend process (`POST /api/maintenance/restart-server`), relying on Docker's `restart: unless-stopped` policy to bring it back up; useful to clear any wedged in-process state (stuck bridge/relay processes, leaked handles) short of a full redeploy.
- **Factory reset** — wipes *everything*: all cameras, recordings, events, grids, notification settings, and the admin account itself, back to a blank install (the next load shows **Setup** again). Requires typing a confirmation phrase ("RESETAR") **and** the current admin password before the request is even sent, given how destructive and irreversible this is (`POST /api/maintenance/factory-reset`).

All five actions are only reachable with an active admin session, same as the rest of the app - see [API Reference → Maintenance](./api-reference.md#maintenance-apimaintenance) for exact request/response shapes.

## Known limitations

See [Troubleshooting → Known limitations](./troubleshooting.md#known-limitations) for the full list (single-admin auth with no roles, WebRTC unused by the player, dev-server proxy gaps, etc).
