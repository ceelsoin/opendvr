<img src="./frontend/public/favicon.svg" width="96" height="96" alt="OpenDVR logo" align="left" />

# OpenDVR

A self-hosted DVR/NVR for your own cameras — discover ONVIF cameras on your LAN or add any RTSP/RTMP/HLS/SRT/MJPEG source directly, watch them all live, record continuously or only on motion, get real-time motion/tamper alerts (with a snapshot or a clip link) on Discord, Telegram, email, a generic webhook, or straight to your phone/desktop as a push notification, control PTZ cameras, scrub through recordings on a multi-camera timeline with continuous playback across clips, and build custom camera grids with their own shareable kiosk URL for a wall-mounted tablet.

<br clear="left"/>

**Stack**: Node.js + TypeScript + Express (backend) · React 19 + TypeScript + Vite (frontend) · [MediaMTX](https://github.com/bluenviron/mediamtx) (streaming/recording engine) · SQLite · Socket.IO.

> 🔐 On first visit you'll be asked to create an admin account (**Setup** page); afterwards, sign in at **/login**. Sessions last 1h. This is a single-admin auth system (no roles/multi-tenant) meant for a trusted LAN - see [docs/configuration.md](./docs/configuration.md) for session/cookie settings, and note that the custom-grid kiosk URLs (`/g/:id`) also require login (no fully public sharing without an account).

## Highlights

- **Bring any camera** — full ONVIF support (auto-discovery on the LAN, PTZ, motion/tamper events, snapshot capture) plus direct sources for anything else: **RTSP, RTMP, HLS, SRT, MJPEG-over-HTTP**, and even an arbitrary **web page** rendered headlessly and captured as a video feed. A VLC-based compatibility relay covers cheap OEM cameras whose RTSP stack doesn't get along with MediaMTX's client.
- **Live grid** with a "fit all cameras on screen" mode (no scrolling, tiles auto-sized to the viewport), per-camera fullscreen, a one-click stream refresh, and a right-click (or "⋮" on mobile) context menu for quick actions.
- **Recording** — continuous or motion-triggered, with per-camera retention. The **Timeline** page reviews multiple cameras side by side, with synchronized scrubbing, a live playback marker, automatic continuous playback across recording gaps, range export, and batch download.
- **Alerts everywhere** — motion/tamper events fan out to Discord, Telegram, email, a generic JSON webhook, and native browser/PWA push notifications, each independently optional. Cameras that go offline for an extended period get their own "unavailable"/"back online" notifications, repeated periodically while still down.
- **Self-healing** — a background reconciliation loop detects MediaMTX restarts, stuck/wedged streams (including VLC relays that stay alive but stop actually relaying frames), and forces a fast re-provision automatically — most connectivity hiccups fix themselves with no manual action.
- **Custom kiosk grids** — build a named grid (which cameras, order, column count) and get a stable, shareable `/g/:id` URL meant to stay open permanently on a dedicated screen.
- **12 languages** in the UI (`react-i18next`), single-admin authentication, a maintenance page (change password, view logs, delete recordings, restart, factory reset), and a live CPU/memory/disk dashboard.

## Quick start (Docker)

```bash
git clone https://github.com/ceelsoin/opendvr.git
cd opendvr
docker compose build
docker compose up -d
```

Open **http://localhost:4000/web/**, create your admin account, then go to **Câmeras → Adicionar câmera** to register your first camera (ONVIF auto-discovery or a direct stream URL).

For manual/local development (hot reload), production builds, and every other detail, see the full documentation:

## Documentation

- **[docs/README.md](./docs/README.md)** — documentation index
- [Getting Started](./docs/getting-started.md) — running locally, Docker, adding your first camera
- [Architecture](./docs/architecture.md) — how backend/frontend/MediaMTX/ONVIF fit together
- [Features](./docs/features.md) — full feature list
- [API Reference](./docs/api-reference.md) — every REST endpoint + WebSocket event
- [Configuration](./docs/configuration.md) — environment variables, MediaMTX config
- [Deployment](./docs/deployment.md) — Docker image, ports, volumes
- [Development](./docs/development.md) — scripts, project layout, conventions
- [Troubleshooting](./docs/troubleshooting.md) — known issues and camera-compatibility notes

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, conventions, and the PR process. Bug reports/feature requests use the templates under `.github/ISSUE_TEMPLATE/`.

## Credits

Created and maintained by **[Celso Inacio](https://github.com/ceelsoin)**.

OpenDVR builds on top of great open-source projects — most notably [MediaMTX](https://github.com/bluenviron/mediamtx) for streaming/recording, plus the npm/Docker dependencies listed in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

## License

This project is licensed under the [MIT License](./LICENSE) — Copyright (c) 2026 Celso Inacio.

Third-party dependencies keep their own licenses (all permissive: MIT, Apache-2.0, BSD, ISC) — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for the full list and attribution.

