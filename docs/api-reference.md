# API Reference

Base URL: `http://<host>:4000/api` (or `/api` relative to wherever the frontend is served, since it's always proxied/same-origin).

**Authentication: session cookie required**, except `GET /api/health` and the `/api/auth/*` endpoints themselves (see below). Sign in via `POST /api/auth/login` (or `POST /api/auth/setup` on first run) - the response sets an `httpOnly` session cookie, sent automatically by the browser on subsequent requests. Sessions expire after 1h (`JWT_EXPIRES_IN`, see [Configuration](./configuration.md)); an expired/missing session gets `401 { "error": "Unauthorized" }`. This also covers the `/hls`, `/recordings`, and `/snapshots` proxies, and the WebSocket connection.

All request bodies are validated with [zod](https://zod.dev); invalid payloads return `400` with `{ error, details }` (`details` is zod's `flatten()` output).

---

## Health

### `GET /api/health`
Returns `{ "status": "ok" }`. No dependencies checked. Does not require a session.

---

## Auth (`/api/auth`)

None of these require an existing session (that would be circular).

### `GET /api/auth/status`
Returns `{ hasUser: boolean, authenticated: boolean }`. `hasUser: false` means no account has been created yet - the frontend shows **Setup** instead of **Login** in that case. `authenticated` reflects whether the request's own session cookie (if any) is currently valid.

### `POST /api/auth/setup`
Body: `{ username, password }` (username 3-64 chars, password 8+ chars). Creates the first (and only) admin account and signs you in (sets the session cookie). Returns `409` if an account already exists - use `/login` instead.

### `POST /api/auth/login`
Body: `{ username, password }`. Verifies against the stored bcrypt hash and sets the session cookie on success. Returns `401` on any mismatch (deliberately doesn't distinguish "unknown user" from "wrong password").

### `POST /api/auth/logout`
Clears the session cookie. No body.

---

## Cameras (`/api/cameras`)

### `GET /api/cameras`
List all cameras (password field stripped from the response).

### `GET /api/cameras/:id`
Get one camera by id. `404` if not found.

### `GET /api/cameras/:id/stream-status`
Live view of MediaMTX's actual state for this camera's path — use this to tell "ONVIF connected" apart from "MediaMTX actually pulling RTSP".

Response:
```jsonc
{
  "configured": true,       // path registered in MediaMTX
  "ready": true,            // RTSP source actually connected
  "sourceType": "rtspSession",
  "readerCount": 1,
  "bytesReceived": 12345678,
  "hlsUrl": "/hls/<id>/index.m3u8",
  "relayUrl": null          // VLC relay RTSP URL, only if rtspCompatMode === "vlc-relay"
}
```

### `POST /api/cameras`
Create a camera. The row is always created even if ONVIF/MediaMTX provisioning fails below (camera ends up with `status: "offline"`).

Body:
| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | |
| `host` | string | yes | |
| `port` | number | no | default `80` |
| `onvifPath` | string | no | default `/onvif/device_service` |
| `username` | string | yes | |
| `password` | string | yes | |
| `mainProfileToken` / `subProfileToken` | string | no | from `/onvif/probe` |
| `rtspMainUri` / `rtspSubUri` | string | no | pre-resolved, from `/onvif/probe` |
| `rtspCompatMode` | `"vlc-relay"` \| `null` | no | enable the VLC RTSP compatibility relay |
| `mainStreamMetadata` / `subStreamMetadata` | `{ width, height, encoding }` | no | display-only, from probe |
| `recordingMode` | `"off"` \| `"continuous"` \| `"motion"` | no | default `"off"` |
| `motionRecording` | boolean | no | enables the ONVIF motion/tamper **alert** listener (independent of `recordingMode`) |
| `retentionDays` | number | no | default `7`. Enforced daily: MediaMTX deletes recordings older than this via a per-camera `recordDeleteAfter` setting, and a backend cron job (`backend/src/jobs/retentionCleanup.ts`) deletes event rows + snapshot files older than this, once a day. |

Returns `201` with the created camera.

### `PATCH /api/cameras/:id`
Partial update (same shape as `POST`, all fields optional). If any connection field changes (`host`, `port`, `onvifPath`, `username`, `password`, `mainProfileToken`) and no new `rtspMainUri` is given, the previously resolved RTSP URI is invalidated and re-resolved via ONVIF on the next provisioning pass. Also restarts/stops the event listener and motion-recording timers as needed based on the new settings.

### `POST /api/cameras/:id/restart`
Forces a full reconnect: re-resolves the RTSP URI via ONVIF and re-registers the MediaMTX path. Returns `{ ok: boolean, status: "online" | "offline" | "unknown" }`.

### `POST /api/cameras/:id/disable`
Administrative on/off switch, distinct from the connectivity-based `status` field. Stops the motion listener/detector, motion-recording cooldown, and VLC relay (if any); deletes the MediaMTX path; sets `enabled: false` on the camera row (config is kept, nothing is deleted). Disabled cameras are skipped on backend boot and by the periodic MediaMTX-path reconciliation loop. Returns the updated camera.

### `POST /api/cameras/:id/enable`
Re-enables a previously disabled camera: sets `enabled: true`, then re-provisions it (fresh ONVIF lookup + MediaMTX path registration, same as `/restart`) and resumes motion detection if configured. Returns the updated camera.

### `DELETE /api/cameras/:id`
Stops the event listener, motion-recording cooldown, and VLC relay (if any); deletes the MediaMTX path (a missing/404 path is treated as already-gone, not an error); deletes the DB row. `204 No Content`.

### `POST /api/cameras/:id/test-connection`
Connects via ONVIF right now and lists available stream profiles, without changing anything persisted.

Success: `{ "ok": true, "streams": [...] }`
Failure: `502` with `{ "ok": false, "error": "...", "details": "..." }` (`details` is the raw underlying error message, e.g. `ECONNRESET`).

---

## Discovery (`/api/discovery`)

### `POST /api/discovery`
Runs a WS-Discovery probe on the LAN.

Body: `{ "timeoutMs"?: number }` (default `5000`).

Response: array of
```jsonc
{ "hostname": "192.168.1.50", "port": 80, "urn": "urn:uuid:...", "xaddrs": ["http://192.168.1.50/onvif/device_service"] }
```

---

## ONVIF (`/api/onvif`)

### `POST /api/onvif/probe`
Connects to a camera via ONVIF (without saving anything) and returns every media profile's resolved RTSP stream URI.

Body — either:
```jsonc
{ "onvifUrl": "http://user:pass@192.168.1.50:80/onvif/device_service" }
```
or separate fields: `{ "host", "port"?, "onvifPath"?, "username", "password" }`.

Response:
```jsonc
{
  "host": "192.168.1.50", "port": 80, "onvifPath": "/onvif/device_service", "username": "admin",
  "streams": [
    { "profileToken": "profile_1", "name": "MainStream", "encoding": "H264", "width": 1920, "height": 1080, "rtspUri": "rtsp://192.168.1.50:554/onvif1" }
  ]
}
```
Failure: `502` with `{ error, details }`.

### `POST /api/onvif/diagnose`
Diagnostic-only, not used by the normal add-camera flow. Sends the same unauthenticated ONVIF call (`GetSystemDateAndTime`) in different SOAP wire formats directly (bypassing the `onvif` package) to narrow down why a camera resets the connection during the ONVIF handshake. Same body shape as `/probe` (username/password optional — enables an extra authenticated attempt).

Response: `{ host, port, onvifPath, results: [{ label, ok, statusCode?, bodyPreview?, error? }, ...] }`.

### `GET /api/onvif/debug/commands`
Lists every command available in the ONVIF debug console, with name/args/description, e.g. `device.info`, `device.capabilities`, `media.profiles`, `ptz.presets`, etc.

### `POST /api/onvif/debug/:cameraId`
Executes one raw ONVIF command against a **stored** camera's saved credentials (the request never supplies credentials directly).

Body: `{ "command": "device.info", "args": [] }`.
Success: `{ "ok": true, "result": <command-specific JSON> }`. Failure: `502` with `{ "ok": false, "error": "..." }`.

---

## PTZ (`/api/ptz`)

### `POST /api/ptz/:id/move`
Body: `{ "direction": "up"|"down"|"left"|"right"|"upLeft"|"upRight"|"downLeft"|"downRight", "speed"?: number (0-1) }`. `204` on success, `502` on PTZ failure.

### `POST /api/ptz/:id/stop`
Stops any ongoing continuous move. `204`.

### `GET /api/ptz/:id/presets`
Lists saved PTZ presets for the camera.

### `POST /api/ptz/:id/presets`
Body: `{ "name": string }`. Saves the camera's current position as a new preset. `201` with the created preset.

### `POST /api/ptz/:id/presets/:token/goto`
Moves the camera to a saved preset. `204`.

All PTZ endpoints return `404` if the camera doesn't exist, and `502` with a generic error message if the ONVIF PTZ call itself fails.

---

## Recordings (`/api/recordings`)

### `GET /api/recordings/:cameraId?start=<ISO8601>&end=<ISO8601>`
Lists recorded segments for a camera within an optional time range, read live from MediaMTX's Playback API (no separate recordings DB).

Response: array of
```jsonc
{ "start": "2026-07-28T10:00:00Z", "duration": 60, "url": "/recordings/get?path=<cameraId>&start=...&duration=60" }
```
`url` is relative and always points back at this same backend (proxied to MediaMTX, see [Architecture](./architecture.md)) — fetch the actual video bytes from it directly (e.g. as a `<video src>`).

---

## Events (`/api/events`)

### `GET /api/events?cameraId=&type=&from=&to=`
All filters optional. `from`/`to` default to "since forever" / "now" (ISO 8601). `404` if `cameraId` is given but doesn't exist.

Response: array of
```jsonc
{ "id": "...", "camera_id": "...", "type": "tns1:VideoSource/MotionAlarm", "occurred_at": "2026-07-28T10:00:00Z", "metadata": {...} | null, "read": false, "snapshotUrl": "/snapshots/<cameraId>/<eventId>.jpg" | null }
```

### `GET /api/events/:id`
Single event by id.

### `PATCH /api/events/:id`
Body: `{ "read": boolean }`. Marks an event read/unread.

### `DELETE /api/events/:id`
Deletes an event. `204`.

---

## Custom grids (`/api/grids`)

A saved layout: name, column count, and an **ordered** list of camera ids. Like every other endpoint, this now requires a session too - the kiosk URL (`/g/:id`) redirects to `/login` if there isn't one (see [Troubleshooting](./troubleshooting.md#known-limitations) for what this means for sharing it).

### `GET /api/grids`
List all grids.

### `GET /api/grids/:id`
Get one grid. This is the endpoint the kiosk view page (`/g/:id`) calls. `404` if not found.

### `POST /api/grids`
Body: `{ "name": string, "columns"?: number (1-8, default 3), "cameraIds": string[] }` (order of the array = display order).

### `PATCH /api/grids/:id`
Partial update, same shape.

### `DELETE /api/grids/:id`
`204` on success, `404` if not found.

---

## Settings (`/api/settings`)

Runtime-editable configuration, persisted in the database (takes precedence over the env vars in [Configuration](./configuration.md), which only serve as deploy-time/first-boot defaults). Backs the **Configurações** page.

### `GET /api/settings/notifications`
Returns the current notification-channel configuration. Never returns raw secrets (webhook URLs, bot tokens, SMTP password) - only whether each channel is configured (`*Configured: boolean`) plus its non-secret fields (e.g. `emailSmtpHost`, `emailSmtpPort`, `emailFrom`/`emailTo`) and each channel's `*AttachSnapshot` toggle.

### `PUT /api/settings/notifications`
Partial update. Body: any subset of `discordWebhookUrl`, `discordAttachSnapshot`, `telegramBotToken`, `telegramChatId`, `telegramAttachSnapshot`, `webhookUrl`, `webhookAttachSnapshot`, `emailSmtpHost`, `emailSmtpPort`, `emailSmtpUser`, `emailSmtpPass`, `emailSmtpSecure`, `emailFrom`, `emailTo`, `emailAttachSnapshot`. A field set to `null` clears/disables that value; a field simply **omitted** leaves it unchanged (this is how the UI supports "leave the secret blank to keep the existing one"). Returns the updated settings in the same shape as `GET`.

### `POST /api/settings/notifications/test`
Sends a real test notification through one channel right now, using its currently saved configuration.

Body: `{ "channel": "discord" | "telegram" | "webhook" | "email" | "push" }`.
Success: `{ "ok": true }`. Failure: `502` with `{ "ok": false, "error": "..." }` (e.g. invalid webhook URL, SMTP auth failure, or no push subscription registered yet).

---

## Push notifications (`/api/push`)

Browser/PWA Web Push subscriptions - see [Features → Push notifications](./features.md#push-notifications-pwa). Backed by [backend/src/lib/webPush.ts](../backend/src/lib/webPush.ts) and the `push_subscriptions` table.

### `GET /api/push/vapid-public-key`
Returns `{ "publicKey": "..." }` - the VAPID public key the frontend needs to create a `PushSubscription` via `pushManager.subscribe()`. Generated automatically on first use and persisted in the `settings` table (or pinned via `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env vars - see [Configuration](./configuration.md)); stable across restarts either way.

### `POST /api/push/subscribe`
Registers (or refreshes, if the same `endpoint` already exists) a browser/device subscription.

Body: `{ "endpoint": "https://...", "keys": { "p256dh": "...", "auth": "..." } }` (the exact shape of `PushSubscription.toJSON()`).
Response: `201 { "ok": true }`.

### `POST /api/push/unsubscribe`
Removes a subscription so it stops receiving pushes.

Body: `{ "endpoint": "https://..." }`.
Response: `{ "ok": true }`.

---

## System (`/api/system`)

### `GET /api/system/stats`
Current CPU/memory/disk usage of the host the backend is running on - backs the **Dashboard** page and the compact status bar shown in the sidebar layout on every screen. No configuration needed; computed from Node's built-in `os`/`fs` modules (see [Architecture](./architecture.md)).

Response:
```jsonc
{
  "cpu": { "usagePercent": 12.3, "cores": 10, "loadAvg": [1.59, 0.84, 0.69] },
  "memory": { "totalBytes": 8381853696, "freeBytes": 6839517184, "usedBytes": 1542336512, "usagePercent": 18.4 },
  "disks": [
    { "label": "Recordings", "path": "/recordings", "totalBytes": 43826053120, "freeBytes": 14917840896, "usedBytes": 28908212224, "usagePercent": 66 },
    { "label": "Application data", "path": "/data", "totalBytes": 43826053120, "freeBytes": 14917840896, "usedBytes": 28908212224, "usagePercent": 66 }
  ],
  "uptimeSeconds": 967624.17
}
```
`disks` always reports both `RECORDINGS_DIR` and `DATA_DIR` (see [Configuration](./configuration.md)) - if they resolve to the same filesystem, both entries simply show identical numbers.

---

## Static/proxy routes (not under `/api`)

| Route | Purpose |
|---|---|
| `GET /hls/:cameraId/index.m3u8` (+ segments) | Reverse-proxied to MediaMTX's HLS server. Rewrites MediaMTX's cookie-check redirect `Location` header to keep the `/hls` prefix. |
| `GET /recordings/get?path=&start=&duration=` | Reverse-proxied to MediaMTX's Playback server (used by the `url` field returned from `/api/recordings/:cameraId`). |
| `GET /snapshots/:cameraId/:eventId.jpg` | Static files — event snapshots captured by the ONVIF event listener. |
| `GET /web/*` | The built frontend SPA (production only — only exists after `npm run build`; falls back to `index.html` for client-side routes). |

---

## WebSocket events (Socket.IO, `/socket.io`)

The server broadcasts to **all** connected clients (no rooms/targeting):

| Event | Payload | When |
|---|---|---|
| `camera:event` | `{ cameraId, type, occurredAt, ...extra }` | An ONVIF motion/tamper/etc. event was received for a camera with alerts enabled. |
| `camera:status` | `{ cameraId, status }` | Emitted by `emitCameraStatus()` (available for future use — not currently called from anywhere in the codebase, so camera status updates are only reflected via re-fetching `/api/cameras`, not real-time). |

The frontend only listens for `camera:event` today ([EventSocketListener](../frontend/src/components/realtime/EventSocketListener.tsx)).
