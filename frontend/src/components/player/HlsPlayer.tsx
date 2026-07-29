import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Hls from "hls.js";

interface HlsPlayerProps {
  src: string;
  className?: string;
}

type PlayerState = "loading" | "playing" | "error";

/**
 * Plays an HLS stream (MediaMTX output, proxied through the backend at
 * /hls/<cameraId>/index.m3u8). Uses hls.js where needed, falling back to
 * the browser's native HLS support (Safari).
 */
export function HlsPlayer({ src, className }: HlsPlayerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<PlayerState>("loading");

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
  }, [src]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <video ref={videoRef} className="h-full w-full object-contain" autoPlay muted playsInline />
      {state !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-sm text-neutral-500">
          {state === "loading" ? t("player.connecting") : t("player.unavailable")}
        </div>
      )}
    </div>
  );
}
