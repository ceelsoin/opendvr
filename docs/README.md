# OpenDVR — Documentation

OpenDVR is a self-hosted DVR/NVR (in the spirit of Agent DVR / iSpy / Shinobi): discover and register ONVIF cameras on your LAN or add any RTSP/RTMP/HLS/SRT/MJPEG/web-page source directly, watch them all live, record continuously or on motion, receive motion/tamper alerts on Discord/Telegram/email/webhook/push, control PTZ cameras, browse recorded footage on a multi-camera timeline, and build custom camera grids with their own shareable URL for kiosk-style displays.

This folder contains the full project documentation. Start here, then jump to the section you need:

| Document | What's in it |
|---|---|
| [Getting Started](./getting-started.md) | Prerequisites, cloning, running locally (Docker or manual dev mode), adding your first camera |
| [Architecture](./architecture.md) | How the pieces fit together: backend, frontend, MediaMTX, ONVIF, SQLite, WebSocket |
| [Features](./features.md) | Full feature list: authentication, camera sources, live streaming, recording/timeline, events/alerts, PTZ, custom grids, maintenance, debug console |
| [API Reference](./api-reference.md) | Every REST endpoint, request/response shape, and WebSocket event |
| [Configuration](./configuration.md) | All environment variables (backend + docker-compose) and MediaMTX config |
| [Deployment](./deployment.md) | Docker/docker-compose deployment guide, image build details, ports, volumes |
| [Backup & Migration](./backup-and-migration.md) | What to back up, how to back it up safely, restoring/migrating to a new host |
| [Development](./development.md) | Repository layout, scripts, typecheck/build/lint, coding conventions, helper scripts |
| [Troubleshooting](./troubleshooting.md) | Known issues, camera-compatibility quirks, and how the app self-heals |
| [Motion Detection (video/OpenCV)](./motion-detection.md) | Local video-based motion detector, an alternative to ONVIF Events |
| [Chinese OEM cameras (Yoosee, iCSee...)](./chinese-oem-cameras.md) | Known limitations, fallbacks (vlc-relay, video detection), and how to restart these cameras |
| [WebRTC P2P without port forwarding (option, Cloudflare)](./webrtc-p2p-cloudflare.md) | Not-yet-implemented proposal for publishing streams to the web without opening ports on the router |
| [Contributing](../CONTRIBUTING.md) | Setup, coding conventions, how to validate changes, and the pull request process |

## Project at a glance

- **Backend**: Node.js + TypeScript + Express 5, SQLite (`better-sqlite3`), Socket.IO, served from `backend/`.
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4, served from `frontend/`, built and served by the backend in production under `/web`.
- **Media engine**: [MediaMTX](https://github.com/bluenviron/mediamtx) handles RTSP/RTMP/HLS/SRT ingestion, HLS/WebRTC republishing, and native disk recording. The backend never transcodes video itself, except for the ffmpeg-based bridges used by the MJPEG-over-HTTP/web-page source types and video rotation.
- **Camera sources**: full ONVIF (discovery, device info, PTZ, motion/tamper events) via the `onvif` and `node-onvif` npm packages, or a directly-entered RTSP/RTMP/HLS/SRT/MJPEG-HTTP/web-page URL for anything else — see [Features → Camera management](./features.md#camera-management).
- **Authentication**: single-admin session auth (Setup on first run, then Login; JWT in an `httpOnly` cookie) — no roles/multi-tenant. See [Features → Authentication](./features.md#authentication) and [Configuration](./configuration.md). Do not expose this stack directly to the public internet without a reverse proxy adding TLS.
