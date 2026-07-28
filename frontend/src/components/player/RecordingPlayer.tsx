interface RecordingPlayerProps {
  src: string | null;
  className?: string;
}

/**
 * Plays a recorded segment (fMP4, natively playable in browsers) served by
 * MediaMTX's Playback server via this backend's /recordings proxy (see
 * app.ts). Unlike the live HlsPlayer, no hls.js is needed here - it's a
 * plain VOD file, so a native <video> element handles seeking/controls.
 */
export function RecordingPlayer({ src, className }: RecordingPlayerProps) {
  return (
    <div className={`relative bg-black ${className ?? ""}`}>
      {src ? (
        // key=src forces the <video> to reload when the segment changes.
        <video key={src} controls autoPlay className="h-full w-full object-contain">
          <source src={src} type="video/mp4" />
        </video>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-neutral-600">
          Selecione um trecho na linha do tempo
        </div>
      )}
    </div>
  );
}
