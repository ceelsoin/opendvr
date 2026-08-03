import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Hls from "hls.js";
import { useStreamSettings } from "../../api/streamSettings";
import { useCameraEventStore } from "../../store/cameraEventStore";
import type { DetectionBox } from "../../api/types";

interface HlsPlayerProps {
  src: string;
  className?: string;
  /** When provided, draws a brief overlay box for any recent detection on this camera (see store/cameraEventStore.ts) - purely client-side, no extra server/network cost. */
  cameraId?: string;
}

type PlayerState = "loading" | "playing" | "error";

// Stable reference (not a fresh `[]` literal per render) - a zustand
// selector must return the SAME reference when nothing relevant changed,
// or useSyncExternalStore sees a "new snapshot" on every call and re-renders
// forever (React error #185, minified) - this bit the live overlay in the
// production build.
const EMPTY_DETECTIONS: DetectionBox[] = [];

const CATEGORY_COLORS: Record<string, string> = {
  person: "#ef4444",
  vehicle: "#3b82f6",
  animal: "#22c55e",
  other: "#eab308",
};

/** Same "object-fit: contain" math the <video> element itself uses - where the actual video pixels land within its (possibly differently-shaped) container, so overlay boxes line up regardless of letterboxing. */
function computeContainRect(containerW: number, containerH: number, videoW: number, videoH: number) {
  if (!containerW || !containerH || !videoW || !videoH) return null;
  const scale = Math.min(containerW / videoW, containerH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: (containerW - width) / 2, top: (containerH - height) / 2, width, height };
}

/**
 * Plays an HLS stream (MediaMTX output, proxied through the backend at
 * /hls/<cameraId>/index.m3u8). Uses hls.js where needed, falling back to
 * the browser's native HLS support (Safari). Buffer/latency tuning comes
 * from the Settings page's stream section (see api/streamSettings.ts) -
 * shared/cached across every mounted player, so this adds no extra
 * requests beyond the first.
 */
export function HlsPlayer({ src, className, cameraId }: HlsPlayerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<PlayerState>("loading");
  const [renderRect, setRenderRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const { data: streamSettings } = useStreamSettings();
  const detections = useCameraEventStore((s) => (cameraId ? s.detectionsByCamera[cameraId] : undefined) ?? EMPTY_DETECTIONS);

  // Recomputes the video's actual rendered rect (accounting for
  // object-contain letterboxing) whenever the container resizes or the
  // stream's intrinsic dimensions become known - both matter for
  // positioning the detection overlay boxes below correctly.
  useEffect(() => {
    if (!cameraId) return;
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;

    const recompute = () => {
      setRenderRect(computeContainRect(container.clientWidth, container.clientHeight, video.videoWidth, video.videoHeight));
    };

    recompute();
    video.addEventListener("loadedmetadata", recompute);
    video.addEventListener("resize", recompute);
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(container);
    return () => {
      video.removeEventListener("loadedmetadata", recompute);
      video.removeEventListener("resize", recompute);
      resizeObserver.disconnect();
    };
  }, [cameraId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let destroyed = false;
    let reconnect: (() => void) | null = null;

    const clearRetryTimeout = () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
    };

    const handlePlaying = () => {
      retryCount = 0;
      setState("playing");
    };

    // Capped exponential backoff (2s, 4s, 8s, ... 30s max) so a camera
    // that's genuinely down for a while doesn't get hammered with retries.
    const scheduleReconnect = (fn: () => void) => {
      clearRetryTimeout();
      setState("error");
      const delay = Math.min(2000 * 2 ** retryCount, 30000);
      retryCount += 1;
      retryTimeout = setTimeout(() => {
        if (!destroyed) fn();
      }, delay);
    };

    const setupHlsJs = () => {
      hls = new Hls({
        // The stream may take a moment to become available right after a
        // camera is registered (MediaMTX connects to the source on demand).
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 2000,
        lowLatencyMode: streamSettings?.hlsVariant === "lowLatency",
        liveSyncDurationCount: streamSettings?.playerLiveSyncDurationCount ?? 3,
        maxBufferLength: streamSettings?.playerMaxBufferLength ?? 10,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          scheduleReconnect(() => hls?.startLoad());
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          scheduleReconnect(() => hls?.recoverMediaError());
        } else {
          // Not recoverable in-place - tear the instance down and rebuild
          // it from scratch.
          scheduleReconnect(() => {
            hls?.destroy();
            setupHlsJs();
          });
        }
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    };

    const setupNative = () => {
      video.src = src;
    };

    const handleNativeError = () => scheduleReconnect(setupNative);

    setState("loading");
    if (Hls.isSupported()) {
      reconnect = () => {
        hls?.destroy();
        setupHlsJs();
      };
      setupHlsJs();
      video.addEventListener("playing", handlePlaying);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      reconnect = setupNative;
      setupNative();
      video.addEventListener("playing", handlePlaying);
      video.addEventListener("error", handleNativeError);
    } else {
      setState("error");
    }

    // Mobile browsers/PWAs suspend the underlying network connection while
    // backgrounded, and neither hls.js nor the <video> element reliably
    // fire an error when that happens - without this, the player is stuck
    // showing the stale "unavailable" frame until the user manually hits
    // refresh when reopening the app.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !reconnect) return;
      retryCount = 0;
      clearRetryTimeout();
      setState("loading");
      reconnect();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      destroyed = true;
      clearRetryTimeout();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("error", handleNativeError);
      hls?.destroy();
    };
  }, [src, streamSettings]);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <video ref={videoRef} className="h-full w-full object-contain" autoPlay muted playsInline />
      {state !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-sm text-neutral-500">
          {state === "loading" ? t("player.connecting") : t("player.unavailable")}
        </div>
      )}
      {state === "playing" &&
        renderRect &&
        detections.map((detection) => {
          const [x, y, w, h] = detection.box;
          const color = CATEGORY_COLORS[detection.category] ?? CATEGORY_COLORS.other;
          return (
            <div
              key={detection.trackId}
              className="pointer-events-none absolute border-2"
              style={{
                left: renderRect.left + x * renderRect.width,
                top: renderRect.top + y * renderRect.height,
                width: w * renderRect.width,
                height: h * renderRect.height,
                borderColor: color,
              }}
            >
              <span
                className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[10px] font-medium text-black"
                style={{ backgroundColor: color }}
              >
                {detection.label}
              </span>
            </div>
          );
        })}
    </div>
  );
}
