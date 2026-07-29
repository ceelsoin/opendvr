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

    setState("loading");
    let hls: Hls | null = null;

    const handlePlaying = () => setState("playing");

    if (Hls.isSupported()) {
      hls = new Hls({
        // The stream may take a moment to become available right after a
        // camera is registered (MediaMTX connects to the source on demand).
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 2000,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setState("error");
        }
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      video.addEventListener("playing", handlePlaying);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("playing", handlePlaying);
      video.addEventListener("error", () => setState("error"));
    } else {
      setState("error");
    }

    return () => {
      video.removeEventListener("playing", handlePlaying);
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
