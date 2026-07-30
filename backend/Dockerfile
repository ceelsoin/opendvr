# This Dockerfile is built with the repository root as context (see
# docker-compose.yml: `context: .`, `dockerfile: backend/Dockerfile`) so it
# can access both frontend/ and backend/ and embed the frontend build at
# dist/web, served by the backend under the /web route.
#
# Alpine (musl) is used instead of Debian slim because better-sqlite3 ships
# prebuilt native binaries per platform; its glibc-linked prebuild requires a
# newer glibc than Debian 12 provides, causing ERR_DLOPEN_FAILED at runtime.
# The musl-linked prebuild does not have that problem.

# --- frontend build stage ---------------------------------------------------
# Uses `npm install` instead of `npm ci`: the lockfile was generated on macOS
# and some optional native/WASM-fallback deps (lightningcss/rollup, used by
# Tailwind v4 and Vite) aren't fully pinned for other platforms in it, which
# makes the stricter `npm ci` fail cross-platform.
FROM node:22-slim AS frontend-build

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- backend build stage ----------------------------------------------------
FROM node:22-alpine AS backend-build

# python3/make/g++ are required to compile the better-sqlite3 native addon
# from source (no compatible prebuilt binary ships for musl/Alpine).
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
# Uses `npm install` instead of `npm ci` for the same cross-platform reason
# as the frontend stage above: devDependencies (vitest -> vite -> rolldown)
# pull in optional native/WASM-fallback platform packages that aren't fully
# pinned for musl/Alpine in a lockfile generated on macOS.
RUN npm install
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build:backend
RUN npm prune --omit=dev

# --- llama.cpp build stage ---------------------------------------------------
# Compiles llama.cpp's server binary (CPU-only) from source for item 4's
# "local" auto-captioning provider (see backend/src/media/llamaCppBridge.ts,
# which spawns/manages it directly, driven entirely by Settings-page config -
# model paths, CPU threads, GPU layers). Not available as an Alpine apk
# package, and upstream's prebuilt release binaries are glibc-linked (same
# musl/Alpine constraint as better-sqlite3/py3-opencv elsewhere in this
# file), so building from source is the only option here.
#
# GPU acceleration is deliberately NOT built here: CUDA's toolchain has no
# musl/Alpine support at all, so no llama-server binary running INSIDE this
# image can ever use a GPU. For real GPU-accelerated captioning, run the
# separate `llamacpp-gpu` docker-compose service instead (official prebuilt
# CUDA image, zero risk to this image) and point the "External" captioning
# provider at it - see docs/configuration.md.
FROM alpine:3.20 AS llamacpp-build

RUN apk add --no-cache git cmake make g++ linux-headers

# Pinned to a specific tag for reproducible builds - bump deliberately (check
# https://github.com/ggml-org/llama.cpp/tags for newer ones).
ARG LLAMA_CPP_VERSION=b10192
RUN git clone --depth 1 --branch ${LLAMA_CPP_VERSION} https://github.com/ggml-org/llama.cpp.git /llama.cpp

WORKDIR /llama.cpp
RUN cmake -B build \
      -DCMAKE_BUILD_TYPE=Release \
      -DGGML_NATIVE=OFF \
      -DBUILD_SHARED_LIBS=OFF \
      -DLLAMA_CURL=OFF \
      -DLLAMA_BUILD_TESTS=OFF \
      -DLLAMA_BUILD_EXAMPLES=OFF \
  && cmake --build build --target llama-server -j"$(nproc)"

# --- AI model download stage -------------------------------------------------
# Downloads the face detection/recognition ONNX models (OpenCV Zoo's YuNet
# and SFace - MIT and Apache-2.0 respectively, see THIRD-PARTY-NOTICES.md) at
# build time, so they ship baked into the image instead of requiring a
# manual download (see docs/configuration.md). Kept as its own throwaway
# stage so `curl` doesn't need to be installed in the runtime image.
#
# Also downloads the SmolVLM-500M-Instruct GGUF model + mmproj (Apache-2.0,
# ggml-org's own llama.cpp-ready GGUF conversion - see THIRD-PARTY-NOTICES.md)
# for item 4's "local" auto-captioning provider (see
# backend/src/media/llamaCppBridge.ts) - bundled for the same reason as the
# face models: it's a small (~520MB combined), permissively-licensed model
# that makes the feature work out of the box with zero manual downloads.
#
# Deliberately does NOT include the YOLO object-detection model here: its
# pretrained weights are AGPL-3.0 licensed (Ultralytics), which would
# conflict with this project's all-permissive licensing policy - it stays a
# manual, opt-in download.
#
# media.githubusercontent.com (not raw.githubusercontent.com) is required for
# the opencv_zoo files specifically: they're Git LFS-tracked, and the plain
# raw endpoint only serves the small LFS pointer text file, not the real
# binary. HuggingFace's own `resolve/main` URLs don't have this problem.
FROM alpine:3.20 AS ai-models
RUN apk add --no-cache curl
WORKDIR /models
RUN curl -fL -o face_detection_yunet.onnx \
      https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
 && curl -fL -o face_recognition_sface.onnx \
      https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
RUN mkdir -p llm \
 && curl -fL -o llm/SmolVLM-500M-Instruct-Q8_0.gguf \
      https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf \
 && curl -fL -o llm/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf \
      https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf

# --- runtime stage -----------------------------------------------------------
FROM node:22-alpine AS runtime

# ffmpeg is kept available for snapshot/thumbnail generation. Recording of
# camera streams itself is handled natively by the MediaMTX service.
#
# vlc is used only as an on-demand RTSP compatibility relay (media/vlcRelay.ts)
# for cameras whose RTSP server doesn't work with MediaMTX's Go RTSP client
# (see that file for details) - VLC's live555-based client is more tolerant
# of such quirks. Alpine's vlc package links against real live555
# (Debian/Ubuntu's does not, for licensing reasons), which is why Alpine is
# used here instead of a Debian-based runtime stage.
# VLC refuses to run as root, so a dedicated unprivileged user (fixed uid/gid
# so vlcRelay.ts can reference it) is created for that child process only -
# the rest of the app keeps running as root as before.
#
# py3-opencv (Alpine's own prebuilt package, NOT pip's opencv-python -
# manylinux wheels are glibc-only and won't run on musl/Alpine, and building
# OpenCV from source is impractically heavy) powers the video-based motion
# detector (media/motionDetector.ts spawns motion_worker.py per camera) AND
# the shared AI vision worker (media/visionWorker.ts spawns ONE
# vision_worker.py process for the whole app - see that script for object
# detection/face recognition, both implemented via cv2.dnn/cv2.FaceDetectorYN/
# cv2.FaceRecognizerSF, deliberately with NO extra Python ML dependency like
# onnxruntime/torch - those don't ship musl-compatible wheels either).
# The face detection/recognition model weight files, AND the SmolVLM-500M
# captioning model + mmproj, ARE bundled in this image (see the "ai-models"
# stage above + docker-entrypoint.sh); the YOLO object-detection one is not
# (AGPL-3.0 weights - see docs/configuration.md) and stays a manual download,
# disabling only that specific capability.
#
# chromium + freetype/harfbuzz/ttf-freefont: headless browser used by the
# "webpage" camera source type (media/webpageBridge.ts) to render an
# arbitrary URL as a video feed (Playwright's own bundled Chromium download
# is skipped entirely - `playwright-core` instead drives this
# already-installed, Alpine-native build via `executablePath`, same
# rationale as py3-opencv: prebuilt platform packages over huge downloads
# that may not even support musl). This is by far the heaviest optional
# runtime dependency in this image - only pulled in for that one source type.
#
# libstdc++/libgomp: runtime shared libs the llama.cpp build above links
# against dynamically (g++/OpenMP) - NOT part of node:22-alpine by default.
RUN apk add --no-cache ffmpeg vlc py3-opencv chromium ttf-freefont libstdc++ libgomp \
  && addgroup -g 10001 vlcrelay \
  && adduser -D -H -h /tmp -u 10001 -G vlcrelay vlcrelay

WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json ./
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /frontend/dist ./dist/web
COPY backend/motion_worker.py ./motion_worker.py
COPY backend/vision_worker.py ./vision_worker.py
COPY --from=llamacpp-build /llama.cpp/build/bin/llama-server /usr/local/bin/llama-server
# Bundled model files, seeded into the bind-mounted ${DATA_DIR}/models volume
# on first boot by docker-entrypoint.sh - not placed directly at /data/models
# here because /data is a host bind mount (see docker-compose.yml), which
# would hide anything baked into the image at that path.
COPY --from=ai-models /models /app/models-seed
COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
