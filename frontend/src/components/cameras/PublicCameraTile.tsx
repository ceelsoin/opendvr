import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HlsPlayer } from "../player/HlsPlayer";
import { useToastStore } from "../../store/toastStore";
import type { PublicGridCamera } from "../../api/types";

/**
 * Minimal, credential-free tile for the public (no-login) custom grid view
 * (CustomGridViewPage's `publicGrid.data` branch) - just the player plus a
 * manual refresh/fullscreen affordance, mirroring the two relevant buttons
 * from CameraTile.tsx. Deliberately does NOT reuse CameraTile itself: that
 * component pulls in authenticated hooks (enable/disable, restart, test
 * connection, diagnostics) that 401 for an anonymous viewer, and this view
 * has no session to make those calls with.
 */
export function PublicCameraTile({ camera }: { camera: PublicGridCamera }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Bumped to force HlsPlayer to fully unmount/remount (via its `key`),
  // tearing down and recreating the hls.js instance - same "refresh" action
  // as CameraTile, needed here since a stuck/dropped stream otherwise has
  // no recovery short of reloading the whole page.
  const [reloadKey, setReloadKey] = useState(0);

  const handleRefreshPlayer = () => setReloadKey((k) => k + 1);
  const handleFullscreen = () => {
    containerRef.current?.requestFullscreen().catch(() => {
      addToast("error", t("cameras.fullscreenFailedToast"));
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <div ref={containerRef} className="group relative aspect-video bg-black">
        <HlsPlayer
          key={reloadKey}
          src={`/hls/${camera.hasSubStream ? `${camera.id}_sub` : camera.id}/index.m3u8`}
          className="h-full w-full"
        />
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={handleRefreshPlayer}
            title={t("cameras.refreshPlayer")}
            className="rounded bg-black/60 p-1.5 text-neutral-300 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleFullscreen}
            title={t("cameras.fullscreenTitle")}
            className="rounded bg-black/60 p-1.5 text-neutral-300 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 0 0-2 2v4m18 0V5a2 2 0 0 0-2-2h-4m0 18h4a2 2 0 0 0 2-2v-4M3 15v4a2 2 0 0 0 2 2h4" />
            </svg>
          </button>
        </div>
      </div>
      <p className="truncate px-3 py-1.5 text-sm">{camera.name}</p>
    </div>
  );
}
