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
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT | Official prebuilt `ghcr.io/ggml-org/llama.cpp:server`/`:server-cuda` images, run as separate optional Docker containers (`llamacpp-cpu`/`llamacpp-gpu` services in `docker-compose.yml`) for item 4's auto-captioning provider; not compiled or linked into the main backend image |

## Bundled AI model weight files

These binary model files are downloaded during the Docker build (`backend/Dockerfile`'s `ai-models` stage) and shipped inside the image itself (not just invoked as an external process), so they're listed here explicitly:

| Model | License | How it's used |
| --- | --- | --- |
| [YuNet face detection](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) (`face_detection_yunet_2023mar.onnx`) | MIT | Loaded by `backend/vision_worker.py` via OpenCV's `cv2.FaceDetectorYN` for face recognition |
| [SFace face recognition](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) (`face_recognition_sface_2021dec.onnx`) | Apache-2.0 | Loaded by `backend/vision_worker.py` via OpenCV's `cv2.FaceRecognizerSF` for face embeddings |
| [SmolVLM-500M-Instruct GGUF](https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF) (`SmolVLM-500M-Instruct-Q8_0.gguf` + `mmproj-SmolVLM-500M-Instruct-Q8_0.gguf`) | Apache-2.0 | Bundled in this image and mounted into the optional `llamacpp-cpu`/`llamacpp-gpu` docker-compose sidecar services (official prebuilt `ggml-org/llama.cpp` images) for item 4's auto-captioning provider |

The optional YOLO object-detection model (`VISION_YOLO_MODEL_PATH`) is **deliberately not bundled**: Ultralytics' pretrained YOLOv8/YOLO11 weights are AGPL-3.0 licensed, which would conflict with the all-permissive policy above - it remains a manual, opt-in download (see [docs/configuration.md](./docs/configuration.md)) and is never part of the distributed image.

## Questions

If you believe any attribution here is missing or incorrect, please open an
issue at [github.com/ceelsoin/opendvr](https://github.com/ceelsoin/opendvr/issues).
