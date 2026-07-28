# Troubleshooting

## "Câmera online" but the live view says "Stream indisponível"

This gap is expected and diagnosable: a camera's `status: "online"` only means **ONVIF** connected successfully and a path was registered in MediaMTX — it says nothing about whether MediaMTX actually managed to open the **RTSP** connection to the camera, which is a completely separate negotiation.

1. Open the camera's tile in the **Grid** page and click **"diagnóstico"**. This polls `GET /api/cameras/:id/stream-status` every 3s and shows:
   - `configured`: is a path even registered in MediaMTX right now?
   - `ready`: is the RTSP source actually connected?
   - `sourceType`, reader count, bytes received.
2. If `configured: false` — the path is missing. This can happen right after a MediaMTX restart (see below); the backend's reconciliation loop re-registers it automatically within 60s, or you can force it immediately by clicking **"Reiniciar"** on the camera.
3. If `configured: true` but `ready: false` for more than ~3 minutes — the backend's self-healing loop will force a full re-provision automatically (this also restarts any VLC relay). If it still doesn't come up, the RTSP connection itself is failing (wrong credentials/URL for RTSP specifically, or a protocol incompatibility — see below).

## MediaMTX paths disappearing / "path not found" in logs

Paths registered through the Control API (`upsertCameraPath`) live **only in MediaMTX's memory** — they are not persisted to `mediamtx.yml` or any volume. Every time the `mediamtx` container/process restarts (crash, `docker compose down/up`, image rebuild), **every** camera path is lost, even though the backend and SQLite still think the camera is fine.

This is handled automatically:
- On backend boot, every stored camera is re-provisioned.
- A 60s reconciliation loop in `backend/src/index.ts` detects a missing path (`configured: false`) and re-registers it.

You should rarely need to intervene, but if you do: click **"Reiniciar"** on the affected camera, or just wait up to a minute.

## A specific camera's ONVIF connection resets ("socket hang up" / `ECONNRESET`)

Some cheap/OEM ONVIF cameras (Hi3518-class chipsets are a common culprit, Yoosee-branded cameras confirmed affected) reset the TCP connection during the SOAP handshake with certain ONVIF client implementations, even though the TCP connection itself opens fine (`code: 'read'` in the error — not a network/routing/Docker problem).

**Root cause identified**: the `onvif` (agsh) package's `connect()` always sends its very first call (`GetSystemDateAndTime`) **without authentication**, per the ONVIF spec (that call is supposed to be public). Some cheap cameras reject *any* unauthenticated call outright, so `connect()` fails before it ever gets to try something authenticated — regardless of SOAP 1.1 vs 1.2 wire format (both were tested and ruled out as the cause).

**Fix applied**: the app uses the `node-onvif` (futomi) package instead for connecting, listing profiles, and resolving RTSP URIs ([backend/src/onvif/device.ts](../backend/src/onvif/device.ts)) — confirmed working against a real affected camera. The `onvif` (agsh) package is still used, but only for the PullPoint **events** subscription, since `node-onvif` doesn't implement that conveniently.

**Known consequence**: a camera whose events-listener connection still uses the old `onvif` package could theoretically hit the same issue for **motion alerts specifically**, even though normal viewing/PTZ/discovery work fine via `node-onvif`. This is a documented limitation, not a regression.

If you hit ONVIF connection issues with a new camera model, use the **ONVIF debug console** (`/onvif-debug`) or `POST /api/onvif/diagnose` to gather more detail before assuming it's the same root cause.

## RTSP works in other tools (VLC, Agent DVR) but MediaMTX gets "bad status code: 400"

Some cheap RTSP servers only accept a Digest-auth retry if it arrives on the **same TCP connection** as the original `401` challenge — a behavior MediaMTX's Go RTSP client (`gortsplib`) doesn't replicate, but VLC's `live555`-based client tolerates fine.

**Workaround built in**: set the camera's compatibility mode to **`vlc-relay`** (checkbox in the add/edit camera dialog). This spawns a headless VLC process (`backend/src/media/vlcRelay.ts`) that pulls the stream once as a real working client and re-serves it as a fresh, unauthenticated RTSP stream on a local port; MediaMTX then pulls from that relay instead of the picky camera directly. The relay is self-healing (auto-restarts on unexpected exit) and is torn down/recreated automatically whenever the camera is reprovisioned.

## Known limitations

These are deliberate scope boundaries or acknowledged gaps, not necessarily bugs:

- **Single-admin authentication, no roles/multi-tenant.** Setup (`/setup`, only shown when no account exists yet) + login (`/login`), session cookie (httpOnly, 1h expiry). There's exactly one tier of access - no read-only/guest roles. The custom-grid kiosk URLs (`/g/:id`) now also require a logged-in session, same as the rest of the app - they're no longer shareable with people who don't have an account. If you need a public/no-login kiosk display again, you'd need to add a separate signed/grid-specific token mechanism (not implemented).
- **WebRTC is exposed but unused.** MediaMTX republishes WebRTC (port 8889), but the frontend player only ever uses HLS.
- **`camera:status` WebSocket event is emitted from nowhere.** The helper function exists (`emitCameraStatus`) but nothing calls it — camera status changes are only visible after re-fetching `/api/cameras`, not in real time.
- **Dev-server proxy gaps.** When running the frontend's Vite dev server separately from the backend (`npm run dev` in `frontend/`), only `/api`, `/socket.io`, and `/hls` are proxied to the backend — `/recordings` (timeline playback) and `/snapshots` (event thumbnails) are **not**, so those specific features won't work correctly unless you access the app through the backend directly (or use `docker compose`/production build) while developing.
- **No automated tests.** See [Development](./development.md#testing).
- **Some cheap OEM cameras advertise ONVIF Events support (`WSPullPointSupport: true`) they don't actually implement** - any Events-namespace SOAP request just hangs up the TCP connection, regardless of client (confirmed against real hardware, unrelated to the `onvif` vs `node-onvif` package choice). Use `motionDetectionSource: "video"` (OpenCV analysis of the stream, the default for newly-created cameras) for these instead of `"onvif"`.
