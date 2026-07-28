#!/usr/bin/env bash
# Isolated validation for the "VLC as RTSP compatibility relay" idea.
# NOT wired into the main docker-compose.yml - this is just to prove the
# concept works before deciding whether to integrate it for real.
#
# What it does:
#   1. Builds a minimal headless VLC image (vlc-nox, no GUI).
#   2. Runs it pulling the real camera's RTSP stream (over TCP, since that's
#      already our reliable choice) and re-serving it as a brand new, plain
#      RTSP stream on a local port.
#   3. You then point our existing test-rtsp-isolated.js script (or ffprobe/
#      VLC/MediaMTX) at that relayed URL to confirm it behaves like a normal,
#      compliant RTSP source (no more picky Digest-over-persistent-connection
#      quirks, because the camera-facing side is handled entirely by VLC).
#
# Usage:
#   ./run.sh <cameraHost> <cameraPort> <cameraPath> <username> <password> [relayPort]
#
# Example (matches the camera we've been debugging):
#   ./run.sh 192.168.88.35 554 /onvif1 admin dhy42imb 8554

set -euo pipefail

CAMERA_HOST="$1"
CAMERA_PORT="${2:-554}"
CAMERA_PATH="${3:-/}"
USERNAME="$4"
PASSWORD="$5"
RELAY_PORT="${6:-8554}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="ipcam-vlc-relay-test"

echo "==> Building headless VLC test image..."
docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

SOURCE_URL="rtsp://${USERNAME}:${PASSWORD}@${CAMERA_HOST}:${CAMERA_PORT}${CAMERA_PATH}"

echo "==> Starting relay: pulling from ${SOURCE_URL}"
echo "==> Will re-serve as rtsp://<container-host>:${RELAY_PORT}/relay"
echo "==> Press Ctrl+C to stop."
echo

docker run --rm -it \
  -p "${RELAY_PORT}:${RELAY_PORT}" \
  "$IMAGE_NAME" \
  -vvv "$SOURCE_URL" \
  --rtsp-tcp \
  --sout "#rtp{sdp=rtsp://:${RELAY_PORT}/relay}" \
  --sout-keep
