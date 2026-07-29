# Third-Party Notices

OpenDVR itself is licensed under the [MIT License](./LICENSE). This project
also uses open-source third-party software, either as npm dependencies bundled
into the backend/frontend, or as external tools invoked as separate processes
(Docker containers / spawned CLI binaries). This file lists them and their
licenses for attribution and compliance purposes.

None of the direct dependencies below use a copyleft license (GPL/LGPL/AGPL),
so there is no license conflict with distributing OpenDVR's own code under MIT.

## Backend (Node.js) — npm dependencies

| Package | License |
| --- | --- |
| @aws-sdk/client-s3 | Apache-2.0 |
| bcryptjs | BSD-3-Clause |
| better-sqlite3 | MIT |
| cors | MIT |
| dotenv | BSD-2-Clause |
| express | MIT |
| http-proxy-middleware | MIT |
| jsonwebtoken | MIT |
| ms | MIT |
| node-cron | ISC |
| node-onvif | MIT |
| nodemailer | MIT-0 |
| onvif | MIT |
| pino | MIT |
| pino-http | MIT |
| playwright-core | Apache-2.0 |
| sharp | Apache-2.0 |
| socket.io | MIT |
| uuid | MIT |
| xml2js | MIT |
| zod | MIT |

## Frontend (React/Vite) — npm dependencies

| Package | License |
| --- | --- |
| @tailwindcss/vite | MIT |
| @tanstack/react-query | MIT |
| axios | MIT |
| date-fns | MIT |
| hls.js | Apache-2.0 |
| i18next | MIT |
| nipplejs | MIT |
| react | MIT |
| react-dom | MIT |
| react-grid-layout | MIT |
| react-i18next | MIT |
| react-router-dom | MIT |
| socket.io-client | MIT |
| tailwindcss | MIT |
| zod | MIT |
| zustand | MIT |

Build-only tooling (TypeScript, Vite, oxlint, tsx, pino-pretty, @types/*, etc.)
is not distributed with the application and is omitted from this list.

## External tools (not npm dependencies, run as separate processes)

These are not linked into OpenDVR's code — they run as independent Docker
containers or spawned CLI processes, communicating over the network or via
stdio, so their licenses do not impose any obligations on OpenDVR's own MIT
license.

| Software | License | How it's used |
| --- | --- | --- |
| [MediaMTX](https://github.com/bluenviron/mediamtx) | MIT | Streaming/recording engine, runs as its own Docker container (`mediamtx` service in `docker-compose.yml`) |
| [FFmpeg](https://ffmpeg.org/) | LGPL-2.1+ / GPL-2.0+ (depends on build configuration) | Invoked as a CLI subprocess (`child_process.spawn`) for snapshots/thumbnails and bridging; not statically or dynamically linked into OpenDVR's code |
| [Chromium](https://www.chromium.org/) | BSD-style (multiple licenses) | Launched as a subprocess via `playwright-core` for the webpage-source bridge (`media/webpageBridge.ts`) |

## Questions

If you believe any attribution here is missing or incorrect, please open an
issue at [github.com/ceelsoin/opendvr](https://github.com/ceelsoin/opendvr/issues).
