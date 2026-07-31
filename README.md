<img src="./frontend/public/favicon.svg" width="96" height="96" alt="OpenDVR logo" align="left" />

# OpenDVR

**An AI-powered, self-hosted DVR/NVR for your own cameras.** Discover ONVIF cameras on your LAN or add any RTSP/RTMP/HLS/SRT/MJPEG source directly, watch them all live, record continuously or only on motion, and let on-device AI (YOLO object detection, face recognition, and VLM auto-captioning) tell you *what* actually happened — not just that "something moved." Get real-time alerts (with a snapshot, an AI-generated caption, or a clip link) on Discord, Telegram, email, a generic webhook, or straight to your phone/desktop as a push notification, control PTZ cameras, scrub through recordings on a multi-camera timeline, and build custom camera grids — including a rotating/mosaic broadcast stream you can point a TV, VLC, or a cheap SBC (Orange Pi, Raspberry Pi) at.

<br clear="left"/>

**Stack**: Node.js + TypeScript + Express (backend) · React 19 + TypeScript + Vite (frontend) · [MediaMTX](https://github.com/bluenviron/mediamtx) (streaming/recording engine) · OpenCV (YOLO/YuNet/SFace inference) · [llama.cpp](https://github.com/ggml-org/llama.cpp) (VLM auto-captioning) · SQLite · Socket.IO.

> 🔐 On first visit you'll be asked to create an admin account (**Setup** page); afterwards, sign in at **/login**. This is a single-admin auth system (no roles/multi-tenant) meant for a trusted LAN — see [docs/configuration.md](./docs/configuration.md) for session/cookie settings.

## 🤖 AI-powered, out of the box

- **Object detection** — a YOLO (nano) model classifies every motion-triggered frame into `person` / `vehicle` / `animal` / `other`, turning a generic "motion detected" into a specific, actionable event and suppressing false positives (shadows, wind, compression noise) that never resembled anything real. Opt out of specific categories per camera (e.g. ignore `animal` to stop pets from alerting).
- **Face recognition** — whenever a person is detected, OpenCV's YuNet + SFace models check the face against a library of enrolled photos (**Faces** page) via cosine similarity, so you know *who* it was, not just that someone was there.
- **Zone of interest** — draw a polygon over the camera view to restrict detections to the area that actually matters (e.g. ignore the public sidewalk visible through your gate). Applies to motion, object, and face detection alike.
- **AI auto-captioning (VLM)** — a vision-language model writes a short, human-readable caption for notable events ("a person walks up to the front door carrying a package"), attached to the event and to every external notification. Three interchangeable providers, switchable from Settings with zero extra config: **External** (any OpenAI-compatible endpoint — a hosted API or a remote Ollama/LM Studio), or the bundled **CPU**/**GPU** [llama.cpp](https://github.com/ggml-org/llama.cpp) sidecar containers (official prebuilt images, a small VLM model included) for fully local, no-API-key captioning.
- **Process health dashboard** — see, at a glance, whether every AI pipeline is actually running: the shared vision worker, which AI models loaded successfully, and per-camera whether object detection/face recognition are *enabled* vs. actually *active* (they only run on the local video-analysis motion pipeline, not ONVIF events) — no more guessing why a feature seems to do nothing.
- Every AI feature is **fully opt-in and gracefully degrades**: no model files, no captioning endpoint configured, or the vision worker down just disables that one capability — the rest of the app (plain motion detection included) keeps working exactly as before.

## Highlights

- **Bring any camera** — full ONVIF support (auto-discovery on the LAN, PTZ, motion/tamper events, snapshot capture) plus direct sources for anything else: **RTSP, RTMP, HLS, SRT, MJPEG-over-HTTP**, and even an arbitrary **web page** rendered headlessly and captured as a video feed. A VLC-based compatibility relay covers cheap OEM cameras whose RTSP stack doesn't get along with MediaMTX's client.
- **Live grid** with a "fit all cameras on screen" mode (no scrolling, tiles auto-sized to the viewport), per-camera fullscreen, a one-click stream refresh, and a right-click (or "⋮" on mobile) context menu for quick actions — restart, test connection, enable/disable, and edit, all with live log/confirmation modals, no page navigation needed.
- **Recording** — continuous or motion-triggered, with per-camera retention. The **Timeline** page reviews multiple cameras side by side, with synchronized scrubbing, a live playback marker, automatic continuous playback across recording gaps, range export, and batch download.
- **Alerts everywhere** — motion/tamper/AI events fan out to Discord, Telegram, email, a generic JSON webhook, and native browser/PWA push notifications, each independently optional, with an AI caption and/or an 8-second video clip attached. Cameras that go offline for an extended period get their own "unavailable"/"back online" notifications, repeated periodically while still down.
- **Self-healing** — a background reconciliation loop detects MediaMTX restarts, stuck/wedged streams (including VLC relays and transcode bridges that stay alive but stop actually relaying frames), and forces a fast re-provision automatically — most connectivity hiccups fix themselves with no manual action.
- **Custom kiosk grids** — build a named grid (which cameras, order, column count) and get a stable, shareable `/g/:id` URL meant to stay open permanently on a dedicated screen, optionally public (no login) for a device that can't hold a session.
- **Grid broadcast streams** — turn any grid into a single HLS stream, either a **mosaic** (every camera side by side, one frame) or a **rotation** (cameras cycling one at a time) — a bare, no-login URL you can point VLC, a smart TV, or a small device like an Orange Pi/Raspberry Pi at and just leave playing.
- **12 languages** in the UI (see below), single-admin authentication, a maintenance page (change password, view logs, delete recordings, restart, factory reset), and a live CPU/memory/disk/process-health dashboard.

## Full feature list

- **Camera management**: ONVIF LAN discovery + active network scan, per-camera source type (ONVIF/RTSP/RTMP/HLS/SRT/MJPEG-HTTP/web page), video rotation, forced H.264 transcode + resolution downscale, stream diagnostics, enable/disable, restart/reprovision, delete.
- **Live streaming**: HLS playback via `hls.js`, always proxied through the backend (no direct browser↔MediaMTX traffic), per-tile fullscreen/refresh/context menu, "fit all on screen" grid layout.
- **Recording & playback**: continuous or motion-triggered recording, per-camera retention (auto-enforced), multi-camera synchronized Timeline with continuous cross-gap playback, clip export/download (single or batch).
- **Motion & tamper events**: ONVIF PullPoint or local OpenCV video analysis (per camera), real-time WebSocket toasts + tile flash, Events page with filters (camera/day/type), read/unread, delete.
- **AI computer vision**: YOLO object detection, zone of interest, face recognition (enrollment + matching), VLM auto-captioning (external/CPU/GPU), and per-event tags showing exactly which pipeline(s) processed it plus their raw output.
- **Notifications**: Discord, Telegram, generic JSON webhook, email (SMTP), and browser/PWA Web Push — independently configurable, testable in one click, with snapshot/clip/caption attachments.
- **PTZ**: 8-way continuous move + stop, presets (list/save/go-to), inline panel on the Cameras page, works even for non-ONVIF video sources.
- **Custom grids**: named layouts with chosen cameras/order/columns, shareable kiosk URL, optional public (no-login) access, optional mosaic/rotation broadcast stream for TVs and VLC.
- **Dashboard**: CPU/memory/disk usage, plus process-health visibility for MediaMTX, the VLC compatibility relay, every ffmpeg bridge, the motion detectors, the shared vision worker (with per-model load status), the captioning provider, and grid broadcasts.
- **Maintenance**: change password, live log viewer, delete recordings, restart server, factory reset.
- **Security**: single-admin session auth (JWT in an `httpOnly` cookie), everything behind auth except the explicitly public endpoints (health check, public grids/broadcasts you opt into).
- **Internationalization**: 12 languages, automatic browser-language detection, RTL support for Arabic.

## Languages

The UI is available in **12 languages**, with automatic browser-language detection and a switcher in the sidebar (persisted per device):

| | | | |
|---|---|---|---|
| 🇧🇷 Português (BR) | 🇺🇸 English | 🇪🇸 Español | 🇫🇷 Français |
| 🇩🇪 Deutsch | 🇨🇳 中文（简体） | 🇯🇵 日本語 | 🇰🇷 한국어 |
| 🇷🇺 Русский | 🇸🇦 العربية (RTL) | 🇮🇳 हिन्दी | 🇮🇩 Bahasa Indonesia |

## Quick start (Docker)

```bash
git clone https://github.com/ceelsoin/opendvr.git
cd opendvr
docker compose build
docker compose up -d
```

Open **http://localhost:4000/web/**, create your admin account, then go to **Câmeras → Adicionar câmera** to register your first camera (ONVIF auto-discovery or a direct stream URL).

Want local AI auto-captioning? Bring up the CPU or GPU sidecar too (see [Configuration](./docs/configuration.md)):

```bash
docker compose --profile cpu up -d   # or --profile gpu, with an NVIDIA GPU
```

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

