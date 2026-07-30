#!/usr/bin/env python3
"""
Video-based motion detector worker, spawned one per camera by
backend/src/media/motionDetector.ts (see that file for the process
management/respawn side of this).

Reads an RTSP stream (from MediaMTX, which is always-connected to the real
camera - see media/provisioning.ts) via OpenCV, runs a MOG2 adaptive
background subtractor + contour-area filtering, and prints a single-line
JSON event to stdout whenever a large-enough moving blob is detected,
respecting a debounce interval. Node reads these lines and feeds them into
the same event pipeline used for ONVIF PullPoint notifications (see
backend/src/events/cameraEvents.ts).

Why OpenCV instead of a hand-rolled ffmpeg + raw-frame diff: MOG2 maintains
an adaptive background model (handles gradual lighting drift far better
than diffing against just the previous frame) and gives us contour area,
a much more meaningful "how big is the moving thing" signal than a raw
percent-of-changed-pixels count.

Each reported event includes a base64 JPEG of the triggering frame (at
FRAME_EXPORT_WIDTH, a middle ground between the tiny MOG2 analysis frame
and full resolution) so Node can optionally forward it to the shared YOLO
/ face-recognition worker (media/visionWorker.ts, media/objectDetection.ts)
for object classification/zone filtering/face matching - entirely optional,
see that module for the fallback behavior when it's disabled/unavailable.

Usage: python3 motion_worker.py <rtsp_url>
"""
import sys
import json
import time
import base64

import cv2

ANALYSIS_FPS = 5.0
ANALYSIS_INTERVAL_S = 1.0 / ANALYSIS_FPS
RESIZE_WIDTH = 320
# Resolution of the JPEG frame attached to each reported event - higher
# than RESIZE_WIDTH (used only for the cheap MOG2 diff) so YOLO/face
# detection have enough detail to work with, but still far below full
# camera resolution to keep the base64 payload small.
FRAME_EXPORT_WIDTH = 640
# Minimum contour area, as a fraction of the (resized) frame area, to count
# as "motion" rather than noise/compression artifacts.
MIN_AREA_RATIO = 0.01
# Skip evaluating "is this motion" for the first few seconds after opening
# the stream: this gives MOG2's background model time to learn the actual
# background before we start reporting from it, instead of misfiring
# a false "motion" burst against on an near-uninitialized model.
WARMUP_SECONDS = 5.0
# Minimum time between reported events, so a single continuous motion
# doesn't spam the event pipeline (the recording-side cooldown lives
# separately in media/motionRecording.ts).
EVENT_DEBOUNCE_S = 10.0


def log(message: str) -> None:
    """Writes to stderr (Node logs this at debug/warn level) - stdout is
    reserved exclusively for the newline-delimited JSON event protocol."""
    print(message, file=sys.stderr, flush=True)


def main() -> int:
    if len(sys.argv) < 2:
        log("usage: motion_worker.py <rtsp_url>")
        return 2

    rtsp_url = sys.argv[1]
    cap = cv2.VideoCapture(rtsp_url)
    if not cap.isOpened():
        log(f"Failed to open RTSP stream: {rtsp_url}")
        return 1

    subtractor = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=32, detectShadows=False)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    started_at = time.monotonic()
    last_analysis_at = 0.0
    last_event_at = 0.0

    while True:
        ok, frame = cap.read()
        if not ok:
            log("Failed to read frame (stream ended or dropped)")
            return 1

        now = time.monotonic()
        if now - last_analysis_at < ANALYSIS_INTERVAL_S:
            continue
        last_analysis_at = now

        height, width = frame.shape[:2]
        scale = RESIZE_WIDTH / float(width)
        resized = cv2.resize(frame, (RESIZE_WIDTH, max(1, int(height * scale))))

        mask = subtractor.apply(resized)
        if now - started_at < WARMUP_SECONDS:
            # Still warming up the background model - don't report yet.
            continue

        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue

        frame_area = resized.shape[0] * resized.shape[1]
        largest_area = max(cv2.contourArea(c) for c in contours)
        area_ratio = largest_area / frame_area

        if area_ratio < MIN_AREA_RATIO:
            continue
        if now - last_event_at < EVENT_DEBOUNCE_S:
            continue

        last_event_at = now
        export_scale = FRAME_EXPORT_WIDTH / float(width)
        export_frame = cv2.resize(frame, (FRAME_EXPORT_WIDTH, max(1, int(height * export_scale))))
        ok_encode, buffer = cv2.imencode(".jpg", export_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        frame_b64 = base64.b64encode(buffer).decode("ascii") if ok_encode else None
        print(json.dumps({"type": "motion", "areaRatio": round(area_ratio, 4), "frame": frame_b64}), flush=True)


if __name__ == "__main__":
    sys.exit(main())
