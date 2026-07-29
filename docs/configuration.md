# Configuration

## Backend environment variables

The backend reads env vars via [backend/src/config/env.ts](../backend/src/config/env.ts) (loaded from a `.env` file in `backend/` in dev, via `dotenv`). [backend/.env.example](../backend/.env.example) exists as a starting point but is **missing several variables** listed below (kept in sync here — use this table, not just the example file, as the source of truth) — copy it to `backend/.env` and fill in the rest as needed.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port the backend listens on. |
| `NODE_ENV` | `development` | `production` enables serving the built frontend from `dist/web`. |
| `TZ` | `America/Sao_Paulo` | Container/process timezone. Used both for the daily 03:00 retention cron ([jobs/retentionCleanup.ts](../backend/src/jobs/retentionCleanup.ts)) and for human-readable timestamps in notification messages ([notifications/webhooks.ts](../backend/src/notifications/webhooks.ts)). Without it, Node defaults to UTC, which shows up as notification times being several hours ahead of local time. Also read directly as the fallback for `env.timezone`, used explicitly in `toLocaleString` calls as a defense-in-depth measure independent of whether the container's system `TZ` propagates to `Intl`. |
| `JWT_SECRET` | `dev-secret-change-me` | Signs session JWTs (see [Features → Authentication](./features.md#authentication)). **Change this in production** - the default is well-known/insecure. |
| `JWT_EXPIRES_IN` | `1h` | Session/login lifetime. Accepts any [`ms`](https://github.com/vercel/ms)-style string (`1h`, `30m`, `7d`, ...). |
| `COOKIE_SECURE` | `false` | Set to `true` only if this app is deployed behind HTTPS (e.g. a reverse proxy terminating TLS). Leave unset for the common case of plain-HTTP LAN access - setting this without HTTPS breaks login (browsers won't send `Secure` cookies over HTTP). |
| `DATA_DIR` | `./data` | Base directory for persistent app data. |
| `RECORDINGS_DIR` | `./data/recordings` | Where MediaMTX writes recordings — must match the volume MediaMTX itself is configured/mounted to write to (see `mediamtx.yml`'s `recordPath`). |
| `SNAPSHOTS_DIR` | `./data/snapshots` | Where event JPEG snapshots are saved; served at `/snapshots`. |
| `DB_FILE` | `./data/ipcam.db` | SQLite database file path. |
| `FFMPEG_PATH` | `ffmpeg` | Binary used for snapshot/thumbnail generation only (not for live streaming or main recording — MediaMTX does that natively). |
| `FFPROBE_PATH` | `ffprobe` | Companion to `FFMPEG_PATH`. |
| `MEDIAMTX_API_URL` | `http://127.0.0.1:9997` | MediaMTX's Control API (path registration). In Docker, this is `http://mediamtx:9997` (internal network only — **never publish this port to the host/LAN**). |
| `MEDIAMTX_RTSP_URL` | `rtsp://127.0.0.1:8554` | MediaMTX's RTSP listener (used to build the URL for VLC-relay-sourced paths). |
| `MEDIAMTX_HLS_URL` | `http://127.0.0.1:8888` | MediaMTX's HLS server, reverse-proxied by the backend at `/hls`. |
| `MEDIAMTX_PLAYBACK_URL` | `http://127.0.0.1:9996` | MediaMTX's Playback API (recording listing + segment download), reverse-proxied at `/recordings`. |
| `VLC_PATH` | `cvlc` | Headless VLC binary used for the RTSP compatibility relay. |
| `VLC_RELAY_HOST` | `backend` | Hostname MediaMTX uses to reach this backend's VLC relay processes — the docker-compose service name in production. |
| `VLC_RELAY_PORT_START` | `9500` | First port allocated to VLC relay processes (one port per camera using `rtspCompatMode: "vlc-relay"`, incrementing). |
| `DISCORD_WEBHOOK_URL` | unset (disabled) | Optional: post a message (+ snapshot, if the camera isn't recording) to a Discord channel on camera events. |
| `TELEGRAM_BOT_TOKEN` | unset (disabled) | Optional, used with `TELEGRAM_CHAT_ID`, for Telegram event notifications. |
| `TELEGRAM_CHAT_ID` | unset (disabled) | See above. |
| `GENERIC_WEBHOOK_URL` | unset (disabled) | Optional: POSTs a JSON payload (camera, event type, message, timestamp, optional snapshot as base64) to any URL - for custom automations (n8n, Home Assistant, etc). |
| `SMTP_HOST` | unset (disabled) | Optional: enables email notifications. Requires `EMAIL_FROM` and `EMAIL_TO` too. |
| `SMTP_PORT` | `587` | SMTP server port. |
| `SMTP_USER` / `SMTP_PASS` | unset | SMTP auth credentials, if the server requires them. |
| `SMTP_SECURE` | `false` | Set to `true` for implicit TLS (port 465); STARTTLS on 587 doesn't need this. |
| `EMAIL_FROM` / `EMAIL_TO` | unset | Sender/recipient addresses for email notifications. |
| `PUBLIC_BASE_URL` | unset | Optional, e.g. `http://192.168.1.50:4000`. Used to build a clickable link back to the Timeline in notifications, for cameras that are recording (see [Features](./features.md)). Without it, notifications for recording cameras just omit the link. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | unset (auto-generated) | Optional: pins a specific VAPID key pair for Web Push notifications (see [Features → Push notifications](./features.md#push-notifications-pwa)). Leave unset and a pair is generated automatically on first use and persisted in the database - only set these if you need a stable, pre-known identity (e.g. restoring to a fresh `app-data` volume without re-subscribing every device). |
| `VAPID_SUBJECT` | `mailto:admin@opendvr.local` | Contact URI (mailto: or https:) sent to push services alongside VAPID-signed requests, per the Web Push spec. Cosmetic - only used if a push service ever needs to contact the sender about delivery issues. |
| `HTTPS_PORT` | `4443` | Port for the optional local HTTPS listener (see below) - only used if `HTTPS_CERT_FILE`/`HTTPS_KEY_FILE` are both set. |
| `HTTPS_CERT_FILE` / `HTTPS_KEY_FILE` | unset (disabled) | Optional: paths (inside the container) to a TLS cert/key pair. When both are set and readable, the backend starts a second listener on `HTTPS_PORT`, in addition to the normal HTTP one on `PORT` - see [Local HTTPS for Push notifications](#local-https-for-push-notifications) below. |

> Each notification channel (Discord/Telegram/generic webhook/email) is entirely optional and independent - leaving its variables unset simply disables that channel; nothing else is affected. Every one of these (including the per-channel "attach snapshot" toggle) is also editable at runtime from the **Configurações** page in the UI, persisted in the database - values set there take precedence over these env vars, which remain just the deploy-time/first-boot defaults. Push notifications need no channel-specific env vars at all - just install-time HTTPS (or `localhost` for development) and, per browser/device, clicking "Ativar" on the Settings page.

## Local HTTPS for Push notifications

Browsers only allow Service Workers/the Push API in a "secure context" - HTTPS, or `localhost`. If you access OpenDVR over a LAN IP (e.g. `http://192.168.1.50:4000`), the Settings page will show push notifications as "not supported", even though everything else works fine over plain HTTP.

To fix this **without** a separate reverse proxy, the backend can serve a second listener directly over HTTPS (`backend/src/index.ts`), using a certificate you generate yourself with [mkcert](https://github.com/FiloSottile/mkcert) - a small tool that creates a local Certificate Authority and installs it into your OS/browser trust store, so certs it issues are trusted by your own devices without any warnings.

1. Install mkcert (e.g. `brew install mkcert` on macOS, or see its README for other platforms) and run `mkcert -install` once, on the machine(s) that should trust the certificate (your phone/laptop, not the server).
2. On the server, generate a cert covering however you access it - hostname, LAN IP, or both:
   ```bash
   mkdir -p certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
     opendvr.local 192.168.1.50 localhost
   ```
   (Replace with your own hostname/IP. You can list several - all of them become valid for this one cert.)
3. Set `HTTPS_CERT_FILE=/certs/cert.pem` and `HTTPS_KEY_FILE=/certs/key.pem` (a `.env` file at the repo root, read by `docker-compose.yml`) - the `./certs` folder is already mounted read-only into the container at `/certs` by `docker-compose.yml`.
4. Restart (`docker compose up -d`) and access the app at `https://<hostname-or-ip>:4443` (or whatever `HTTPS_PORT` you chose) instead of the usual `http://...:4000` - only from THIS URL will the Settings page's push notification toggle become available. The plain-HTTP port keeps working unchanged for everything else/every other device.
5. If a device wasn't the one that ran `mkcert -install`, it'll show a certificate warning - either run `mkcert -install` on that device too, or import its root CA manually (`mkcert -CAROOT` prints where the root cert lives).

## docker-compose environment

[docker-compose.yml](../docker-compose.yml) sets all of the above for you with sensible container-network values, and additionally reads two variables **from your shell/`.env` at the repo root** (not required, both optional):

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Passed through to the backend container; same caveat as above (unused today). |
| `DISCORD_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GENERIC_WEBHOOK_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM`, `EMAIL_TO`, `PUBLIC_BASE_URL` | Passed through if set, to enable notifications in the containerized deployment (all optional, same as above). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Passed through if set, to pin push notifications' VAPID identity across deployments (all optional - auto-generated and persisted otherwise, same as above). |

Create a `.env` file next to `docker-compose.yml` (repo root) if you want to set any of these — `docker compose` picks it up automatically:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
TELEGRAM_BOT_TOKEN=123456:ABC-...
TELEGRAM_CHAT_ID=123456789
```

## MediaMTX configuration ([backend/mediamtx.yml](../backend/mediamtx.yml))

Key settings and why they're set this way:

- `readTimeout: 120s` / `writeTimeout: 120s` — raised well above MediaMTX's 10s default to tolerate slow/embedded camera stacks and the VLC compatibility relay without premature `stopped: timed out` errors.
- `api: yes`, `apiAddress: :9997` — Control API enabled on **all interfaces** (not `127.0.0.1`), because the backend reaches it from a different container/IP over the Docker network.
- `authInternalUsers` — grants the `api`/`metrics` actions to any IP (MediaMTX's default only allows this from `127.0.0.1`). This is safe specifically *because* ports `9997` (Control API) and `9996` (Playback API) are **not published** to the host/LAN in `docker-compose.yml` — they're reachable only inside the compose-internal Docker network.

If you run MediaMTX outside Docker, download a release binary from the [MediaMTX GitHub releases page](https://github.com/bluenviron/mediamtx/releases) and run `./mediamtx mediamtx.yml` from `backend/`.

## Frontend configuration

The frontend has no runtime environment variables. The only environment-dependent behavior is the Vite `base` path, set automatically by build mode ([frontend/vite.config.ts](../frontend/vite.config.ts)):
- `vite build` → `base: '/web/'` (matches how the backend serves it in production).
- `vite dev` → `base: '/'`.

In dev, Vite proxies `/api`, `/socket.io`, and `/hls` to `http://localhost:4000` (see that file). Note: **`/recordings` and `/snapshots` are not proxied in dev** — see [Troubleshooting](./troubleshooting.md#known-limitations) if you need timeline playback or snapshots while running the frontend dev server separately from the backend.
