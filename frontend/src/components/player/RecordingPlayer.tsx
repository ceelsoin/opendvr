import { useTranslation } from "react-i18next";

interface RecordingPlayerProps {
  src: string | null;
  className?: string;
  /** Fired on the native <video>'s `timeupdate` event, with its current playback position in seconds - used to move the timeline marker in step with what's actually playing. */
  onTimeUpdate?: (currentTimeSeconds: number) => void;
  /** Fired when the clip finishes playing - used to chain into the next window/segment for continuous playback. */
  onEnded?: () => void;
}

/**
 * Plays a recorded segment (fMP4, natively playable in browsers) served by
 * MediaMTX's Playback server via this backend's /recordings proxy (see
 * app.ts). Unlike the live HlsPlayer, no hls.js is needed here - it's a
 * plain VOD file, so a native <video> element handles seeking/controls.
 */
export function RecordingPlayer({ src, className, onTimeUpdate, onEnded }: RecordingPlayerProps) {
  const { t } = useTranslation();
  return (
    <div className={`relative bg-black ${className ?? ""}`}>
      {src ? (
        // key=src forces the <video> to reload when the segment changes.
        // muted: browsers only guarantee autoplay for muted media - with
        // several players on screen at once (see TimelinePage's grid),
        // unmuted autoplay is inconsistently granted (often only the most
        // recently mounted element gets it), leaving earlier ones paused.
        // Muted autoplay always works; the native `controls` still let the
        // user unmute a specific clip by hand if they need the audio.
        <video
          key={src}
          controls
          autoPlay
          muted
          className="h-full w-full object-contain"
          onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
          onEnded={onEnded}
        >
          <source src={src} type="video/mp4" />
        </video>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-neutral-600">
          {t("player.selectSegment")}
        </div>
      )}
    </div>
  );
}
