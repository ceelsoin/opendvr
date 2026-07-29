<img src="./frontend/public/favicon.svg" width="96" height="96" alt="OpenDVR logo" align="left" />

# OpenDVR

A self-hosted ONVIF/RTSP camera manager — discover cameras on your LAN, watch them live, record continuously or on motion, get motion/tamper alerts, control PTZ, browse recordings on a timeline, and build custom camera grids with their own shareable kiosk URL.

<br clear="left"/>

**Stack**: Node.js + TypeScript + Express (backend) · React 19 + TypeScript + Vite (frontend) · [MediaMTX](https://github.com/bluenviron/mediamtx) (streaming/recording engine) · SQLite · Socket.IO.

> 🔐 On first visit you'll be asked to create an admin account (**Setup** page); afterwards, sign in at **/login**. Sessions last 1h. This is a single-admin auth system (no roles/multi-tenant) meant for a trusted LAN - see [docs/configuration.md](./docs/configuration.md) for session/cookie settings, and note that the custom-grid kiosk URLs (`/g/:id`) now also require login (no more fully public sharing without an account).

## Quick start (Docker)

```bash
git clone https://github.com/ceelsoin/opendvr.git
cd opendvr
docker compose build
docker compose up -d
```

Open **http://localhost:4000/web/**, then go to **Câmeras → Adicionar câmera** to register your first ONVIF camera.

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

