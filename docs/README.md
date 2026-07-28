# OpenDVR — Documentation

OpenDVR is a self-hosted ONVIF/RTSP camera manager (in the spirit of Agent DVR / iSpy / Shinobi): discover and register IP cameras on your LAN, watch them live, record continuously or on motion, receive motion/tamper alerts, control PTZ cameras, browse recorded footage on a timeline, and build custom camera grids with their own shareable URL for kiosk-style displays.

This folder contains the full project documentation. Start here, then jump to the section you need:

| Document | What's in it |
|---|---|
| [Getting Started](./getting-started.md) | Prerequisites, cloning, running locally (Docker or manual dev mode), adding your first camera |
| [Architecture](./architecture.md) | How the pieces fit together: backend, frontend, MediaMTX, ONVIF, SQLite, WebSocket |
| [Features](./features.md) | Full feature list: camera management, live streaming, recording, events/alerts, PTZ, custom grids, debug console |
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
- **Media engine**: [MediaMTX](https://github.com/bluenviron/mediamtx) handles RTSP ingestion, HLS/WebRTC republishing, and native disk recording. The backend never transcodes video itself.
- **Camera control**: ONVIF (discovery, device info, PTZ, motion/tamper events) via the `onvif` and `node-onvif` npm packages.
- **No authentication yet** — see [Configuration](./configuration.md) and [Features](./features.md) for details. Do not expose this stack directly to the public internet without adding your own reverse-proxy auth layer.
