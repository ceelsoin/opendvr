import { getSetting, setSetting } from "../db/settings.repository.js";
import { patchGlobalConfig } from "./mediamtx.js";
import { logger } from "../lib/logger.js";

/**
 * Web HLS player tuning, editable at runtime from the Settings page and
 * persisted in the `settings` table (see db/settings.repository.ts) -
 * addresses slow/failing loads in the browser even when the camera's RTSP
 * source is already connected, since that's a separate layer (MediaMTX's
 * HLS muxer only builds segments on-demand by default, and hls.js's own
 * buffering can add further delay - see media/mediamtx.ts's
 * `patchGlobalConfig` and frontend/src/components/player/HlsPlayer.tsx).
 */
const KEYS = {
  hlsVariant: "stream.hlsVariant",
  hlsSegmentCount: "stream.hlsSegmentCount",
  hlsSegmentDuration: "stream.hlsSegmentDuration",
  hlsPartDuration: "stream.hlsPartDuration",
  hlsSegmentMaxSize: "stream.hlsSegmentMaxSize",
  hlsAlwaysRemux: "stream.hlsAlwaysRemux",
  hlsMuxerCloseAfter: "stream.hlsMuxerCloseAfter",
  preferSubStreamInGrid: "stream.preferSubStreamInGrid",
  playerLiveSyncDurationCount: "stream.playerLiveSyncDurationCount",
  playerMaxBufferLength: "stream.playerMaxBufferLength",
} as const;

export type HlsVariant = "mpegts" | "fmp4" | "lowLatency";

export interface StreamSettings {
  /** "lowLatency" uses LL-HLS (fMP4 parts, lowest latency); "fmp4" fragmented MP4 without parts; "mpegts" maximum compatibility, highest latency. */
  hlsVariant: HlsVariant;
  /** How many segments MediaMTX keeps available for seeking - doesn't affect latency. */
  hlsSegmentCount: number;
  /** Minimum duration of each HLS segment (e.g. "1s"). Lower = faster start, more overhead. */
  hlsSegmentDuration: string;
  /** Minimum duration of each LL-HLS part (e.g. "200ms") - only relevant when hlsVariant is "lowLatency". */
  hlsPartDuration: string;
  /** Maximum size of a single segment, to bound RAM usage (e.g. "50M"). */
  hlsSegmentMaxSize: string;
  /** When true, MediaMTX keeps generating HLS for every active camera continuously, instead of only once a browser requests it - trades RAM for eliminating the "first load" delay/failure this feature targets. */
  hlsAlwaysRemux: boolean;
  /** How long an HLS muxer with no viewers stays warm before MediaMTX tears it down (e.g. "60s") - a higher value means reopening the same camera shortly after is instant. */
  hlsMuxerCloseAfter: string;
  /** Frontend-only: grid tiles load the camera's lower-resolution sub-stream (when the camera has one) instead of the main stream, switching back to main in fullscreen - see CameraTile.tsx. */
  preferSubStreamInGrid: boolean;
  /** Frontend-only: hls.js `liveSyncDurationCount` - how many segments behind the live edge the player targets. Lower = less delay, less tolerance for jitter. */
  playerLiveSyncDurationCount: number;
  /** Frontend-only: hls.js `maxBufferLength`, in seconds - how much video the player buffers ahead. */
  playerMaxBufferLength: number;
}

const DEFAULTS: StreamSettings = {
  // Mirrors MediaMTX's own built-in defaults, so "nothing saved yet" behaves
  // exactly like before this feature existed.
  hlsVariant: "lowLatency",
  hlsSegmentCount: 7,
  hlsSegmentDuration: "1s",
  hlsPartDuration: "200ms",
  hlsSegmentMaxSize: "50M",
  hlsAlwaysRemux: false,
  hlsMuxerCloseAfter: "60s",
  preferSubStreamInGrid: false,
  playerLiveSyncDurationCount: 3,
  playerMaxBufferLength: 10,
};

function getBool(key: string, fallback: boolean): boolean {
  const value = getSetting(key);
  if (value === null) return fallback;
  return value === "1";
}

function getNumber(key: string, fallback: number): number {
  const value = getSetting(key);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getStreamSettings(): StreamSettings {
  return {
    hlsVariant: (getSetting(KEYS.hlsVariant) as HlsVariant | null) ?? DEFAULTS.hlsVariant,
    hlsSegmentCount: getNumber(KEYS.hlsSegmentCount, DEFAULTS.hlsSegmentCount),
    hlsSegmentDuration: getSetting(KEYS.hlsSegmentDuration) ?? DEFAULTS.hlsSegmentDuration,
    hlsPartDuration: getSetting(KEYS.hlsPartDuration) ?? DEFAULTS.hlsPartDuration,
    hlsSegmentMaxSize: getSetting(KEYS.hlsSegmentMaxSize) ?? DEFAULTS.hlsSegmentMaxSize,
    hlsAlwaysRemux: getBool(KEYS.hlsAlwaysRemux, DEFAULTS.hlsAlwaysRemux),
    hlsMuxerCloseAfter: getSetting(KEYS.hlsMuxerCloseAfter) ?? DEFAULTS.hlsMuxerCloseAfter,
    preferSubStreamInGrid: getBool(KEYS.preferSubStreamInGrid, DEFAULTS.preferSubStreamInGrid),
    playerLiveSyncDurationCount: getNumber(KEYS.playerLiveSyncDurationCount, DEFAULTS.playerLiveSyncDurationCount),
    playerMaxBufferLength: getNumber(KEYS.playerMaxBufferLength, DEFAULTS.playerMaxBufferLength),
  };
}

export type UpdateStreamSettingsInput = Partial<StreamSettings>;

export function updateStreamSettings(input: UpdateStreamSettingsInput): StreamSettings {
  if (input.hlsVariant !== undefined) setSetting(KEYS.hlsVariant, input.hlsVariant);
  if (input.hlsSegmentCount !== undefined) setSetting(KEYS.hlsSegmentCount, String(input.hlsSegmentCount));
  if (input.hlsSegmentDuration !== undefined) setSetting(KEYS.hlsSegmentDuration, input.hlsSegmentDuration);
  if (input.hlsPartDuration !== undefined) setSetting(KEYS.hlsPartDuration, input.hlsPartDuration);
  if (input.hlsSegmentMaxSize !== undefined) setSetting(KEYS.hlsSegmentMaxSize, input.hlsSegmentMaxSize);
  if (input.hlsAlwaysRemux !== undefined) setSetting(KEYS.hlsAlwaysRemux, input.hlsAlwaysRemux ? "1" : "0");
  if (input.hlsMuxerCloseAfter !== undefined) setSetting(KEYS.hlsMuxerCloseAfter, input.hlsMuxerCloseAfter);
  if (input.preferSubStreamInGrid !== undefined) {
    setSetting(KEYS.preferSubStreamInGrid, input.preferSubStreamInGrid ? "1" : "0");
  }
  if (input.playerLiveSyncDurationCount !== undefined) {
    setSetting(KEYS.playerLiveSyncDurationCount, String(input.playerLiveSyncDurationCount));
  }
  if (input.playerMaxBufferLength !== undefined) {
    setSetting(KEYS.playerMaxBufferLength, String(input.playerMaxBufferLength));
  }
  return getStreamSettings();
}

/**
 * Pushes the HLS-related fields to MediaMTX's Global Config API. The
 * frontend-only fields (preferSubStreamInGrid, player*) never leave this
 * backend - they're just returned to the Settings page/HlsPlayer as-is.
 * Best-effort: logs and never throws, since a failed patch just means HLS
 * keeps running with whatever config MediaMTX already had.
 */
export async function applyStreamSettingsToMediaMtx(): Promise<void> {
  const settings = getStreamSettings();
  try {
    await patchGlobalConfig({
      hlsVariant: settings.hlsVariant,
      hlsSegmentCount: settings.hlsSegmentCount,
      hlsSegmentDuration: settings.hlsSegmentDuration,
      hlsPartDuration: settings.hlsPartDuration,
      hlsSegmentMaxSize: settings.hlsSegmentMaxSize,
      hlsAlwaysRemux: settings.hlsAlwaysRemux,
      hlsMuxerCloseAfter: settings.hlsMuxerCloseAfter,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to apply stream settings to MediaMTX");
  }
}
