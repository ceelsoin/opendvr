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
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build:backend
RUN npm prune --omit=dev

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
# detector (media/motionDetector.ts spawns motion_worker.py per camera).
RUN apk add --no-cache ffmpeg vlc py3-opencv \
  && addgroup -g 10001 vlcrelay \
  && adduser -D -H -h /tmp -u 10001 -G vlcrelay vlcrelay

WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json ./
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /frontend/dist ./dist/web
COPY backend/motion_worker.py ./motion_worker.py

EXPOSE 4000
CMD ["node", "dist/index.js"]
