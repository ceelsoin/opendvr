import type { Camera } from "../types/camera.js";
import { discoverStreams } from "../onvif/device.js";
import { deleteCameraPath, subStreamPathName, upsertCameraPath } from "./mediamtx.js";
import { withRtspCredentials } from "../lib/rtsp.js";
import { ensureVlcRelay, stopVlcRelay } from "./vlcRelay.js";
import { ensureMjpegBridge } from "./mjpegBridge.js";
import { ensureWebpageBridge } from "./webpageBridge.js";
import { ensureRotationBridge, stopRotationBridge } from "./rotationBridge.js";
import { ensureTimestampBridge, stopTimestampBridge } from "./timestampBridge.js";
import { updateCameraConnection } from "../db/cameras.repository.js";
import { logger } from "../lib/logger.js";

/**
 * (Re)connects to a camera and (re)registers its MediaMTX path. Dispatches
 * based on `camera.sourceType`: full ONVIF flow (discovery + PTZ + events +
 * snapshot) for "onvif" cameras, or a much simpler "just (re)register
 * whatever URL was entered" path for "rtsp"/"rtmp"/"hls"/"srt" cameras -
 * see types/camera.ts's CameraSourceType doc comment for the full
 * rationale. Best-effort either way: never throws, always persists the
 * resulting status ("online"/"offline") on the camera row.
 */
export async function provisionCamera(camera: Camera, options: { forceRefresh?: boolean } = {}): Promise<Camera["status"]> {
  if (camera.sourceType !== "onvif") {
    return provisionDirectSourceCamera(camera, options);
  }
  return provisionOnvifCamera(camera, options);
}

/**
 * Registers a directly-entered stream URL (`camera.rtspMainUri`, despite
 * the name - holds whatever URL scheme matches `camera.sourceType`) as the
 * camera's MediaMTX path, with no ONVIF discovery involved. "mjpeg-http"
 * and "webpage" go through their own ffmpeg-based bridges first (see
 * media/mjpegBridge.ts, media/webpageBridge.ts), which PUBLISH into the
 * path instead of MediaMTX pulling from anywhere (`source: "publisher"`) -
 * MediaMTX can't pull either of those directly (no MJPEG/browser-rendering
 * source type exists). "rtsp" optionally still goes through the VLC
 * compatibility relay (rtspCompatMode) for the same Digest-auth quirk as
 * ONVIF-resolved cameras - not meaningful for rtmp/hls/srt sources.
 */
async function provisionDirectSourceCamera(camera: Camera, options: { forceRefresh?: boolean } = {}): Promise<Camera["status"]> {
  logger.info({ cameraId: camera.id, sourceType: camera.sourceType }, "Provisionando câmera (fonte direta)");
  try {
    if (!camera.rtspMainUri) {
      throw new Error("URL do stream não configurada.");
    }

    if (camera.sourceType === "mjpeg-http" || camera.sourceType === "webpage") {
      await upsertCameraPath(camera.id, {
        source: "publisher",
        sourceOnDemand: false,
        record: camera.recordingMode === "continuous",
        recordDeleteAfter: `${camera.retentionDays}d`,
      });
      if (camera.sourceType === "mjpeg-http") {
        ensureMjpegBridge(camera.id, camera.rtspMainUri, camera.rotation);
      } else {
        await ensureWebpageBridge(camera.id, camera.rtspMainUri, camera.rotation);
      }
      updateCameraConnection(camera.id, { status: "online" });
      return "online";
    }

    if (camera.rtspCompatMode === "vlc-relay") {
      await stopVlcRelay(camera.id);
    }
    const sourceUri =
      camera.sourceType === "rtsp" && camera.rtspCompatMode === "vlc-relay"
        ? await ensureVlcRelay(camera, camera.rtspMainUri)
        : camera.sourceType === "rtsp" && camera.username
          ? withRtspCredentials(camera.rtspMainUri, camera.username, camera.password)
          : camera.rtspMainUri;

    if (camera.rotation !== 0 || camera.transcodeToH264) {
      await stopTimestampBridge(camera.id);
      await upsertCameraPath(camera.id, {
        source: "publisher",
        sourceOnDemand: false,
        record: camera.recordingMode === "continuous",
        recordDeleteAfter: `${camera.retentionDays}d`,
      });
      await ensureRotationBridge(
        camera.id,
        sourceUri,
        camera.rotation,
        camera.transcodeResolution,
        camera.sourceType === "rtsp" && camera.rtspCompatMode === "vlc-relay" ? "udp" : "tcp",
        options.forceRefresh
      );
      updateCameraConnection(camera.id, { status: "online" });
      return "online";
    }
    await stopRotationBridge(camera.id);

    if (camera.sourceType === "rtsp" && camera.rtspCompatMode === "vlc-relay") {
      // See media/timestampBridge.ts: the relay's own RTSP output can't be
      // pulled directly by MediaMTX (its HLS muxer crash-loops on the
      // relay's unreliable timestamps) - publish a sanitized copy instead.
      await upsertCameraPath(camera.id, {
        source: "publisher",
        sourceOnDemand: false,
        record: camera.recordingMode === "continuous",
        recordDeleteAfter: `${camera.retentionDays}d`,
      });
      await ensureTimestampBridge(camera.id, sourceUri);
    } else {
      await stopTimestampBridge(camera.id);
      await upsertCameraPath(camera.id, {
        source: sourceUri,
        sourceOnDemand: false,
        record: camera.recordingMode === "continuous",
        rtspTransport: camera.sourceType === "rtsp" ? "tcp" : undefined,
        recordDeleteAfter: `${camera.retentionDays}d`,
      });
    }
    updateCameraConnection(camera.id, { status: "online" });
    logger.info({ cameraId: camera.id }, "Câmera provisionada com sucesso");
    return "online";
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to provision direct-source stream for camera");
    updateCameraConnection(camera.id, { status: "offline" });
    return "offline";
  }
}

/**
 * Registers (or removes) a second MediaMTX path for the camera's lower-
 * resolution sub-stream, `${camera.id}_sub` (see mediamtx.ts's
 * `subStreamPathName`) - lets the web player load a lighter feed for grid
 * tiles while keeping the main path for fullscreen/recording (see
 * frontend/src/components/cameras/CameraTile.tsx). Only meaningful for
 * ONVIF cameras with a resolved sub-stream URI; removes any stale sub path
 * otherwise (e.g. the user cleared the sub-stream selection on edit).
 * Skipped entirely for `vlc-relay` cameras - that compatibility mode
 * already pins a single RTSP session against the main stream, and the OEM
 * cameras that need it are frequently limited to one concurrent RTSP
 * session in the first place (see media/vlcRelay.ts) - so a second direct
 * connection would likely just break both. Best-effort: never throws, a
 * failure here just means quality-switching isn't available for this
 * camera, the main stream keeps working normally.
 */
async function provisionSubStreamPath(camera: Camera): Promise<void> {
  const subPath = subStreamPathName(camera.id);
  if (!camera.rtspSubUri || camera.rtspCompatMode === "vlc-relay") {
    await deleteCameraPath(subPath);
    return;
  }
  try {
    await upsertCameraPath(subPath, {
      source: withRtspCredentials(camera.rtspSubUri, camera.username, camera.password),
      // Always connected, same reasoning as the main path below - an
      // on-demand sub-stream would reintroduce exactly the "first load
      // waits for the camera" delay this feature is meant to avoid.
      sourceOnDemand: false,
      record: false,
      rtspTransport: "tcp",
    });
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to provision sub-stream MediaMTX path");
  }
}

async function provisionOnvifCamera(camera: Camera, options: { forceRefresh?: boolean } = {}): Promise<Camera["status"]> {
  logger.info({ cameraId: camera.id, forceRefresh: Boolean(options.forceRefresh) }, "Provisionando câmera (ONVIF)");
  try {
    let rtspUri = camera.rtspMainUri ?? undefined;
    let mainStreamMetadata: { width: number | null; height: number | null; encoding: string | null } | undefined;
    let subStreamMetadata: { width: number | null; height: number | null; encoding: string | null } | undefined;

    if (options.forceRefresh || !rtspUri) {
      // Full ONVIF discovery instead of just resolving the main RTSP URI:
      // this also gets us resolution/encoding for the main AND sub streams,
      // which we persist below so the edit form can show it without a fresh
      // probe (previously only the frontend probe populated this, which
      // silently kept it null forever if the user saved without re-probing).
      const streams = await discoverStreams(camera);
      logger.info({ cameraId: camera.id, streamCount: streams.length }, "Descoberta ONVIF concluída");
      const mainProfile = streams.find((s) => s.profileToken === camera.onvifProfileToken) ?? streams[0];
      if (!mainProfile) {
        throw new Error("Câmera conectou, mas não retornou nenhum stream RTSP.");
      }
      rtspUri = mainProfile.rtspUri;
      mainStreamMetadata = { width: mainProfile.width, height: mainProfile.height, encoding: mainProfile.encoding };

      const subProfile = camera.onvifSubProfileToken
        ? streams.find((s) => s.profileToken === camera.onvifSubProfileToken)
        : undefined;
      if (subProfile) {
        subStreamMetadata = { width: subProfile.width, height: subProfile.height, encoding: subProfile.encoding };
      }
    }

    // Cameras flagged as incompatible with MediaMTX's RTSP client go through
    // a VLC relay instead: VLC pulls the real stream (as a working client)
    // and re-serves it as a plain RTSP source that MediaMTX can consume
    // normally. See media/vlcRelay.ts for why this is needed.
    if (camera.rtspCompatMode === "vlc-relay" && options.forceRefresh) {
      // Force a fresh VLC process so credential/host changes take effect.
      // Must fully await the old process's exit before starting a new one:
      // some cameras only support a single concurrent RTSP session, so
      // briefly running two relay processes at once (old + new) makes both
      // fail as they fight over that one session.
      await stopVlcRelay(camera.id);
    }
    const sourceUri =
      camera.rtspCompatMode === "vlc-relay"
        ? await ensureVlcRelay(camera, rtspUri)
        : withRtspCredentials(rtspUri, camera.username, camera.password);

    if (camera.rotation !== 0 || camera.transcodeToH264) {
      await stopTimestampBridge(camera.id);
      await upsertCameraPath(camera.id, {
        source: "publisher",
        sourceOnDemand: false,
        record: camera.recordingMode === "continuous",
        recordDeleteAfter: `${camera.retentionDays}d`,
      });
      await ensureRotationBridge(
        camera.id,
        sourceUri,
        camera.rotation,
        camera.transcodeResolution,
        camera.rtspCompatMode === "vlc-relay" ? "udp" : "tcp",
        options.forceRefresh
      );
      updateCameraConnection(camera.id, {
        rtspMainUri: rtspUri,
        status: "online",
        ...(mainStreamMetadata ? { mainStreamMetadata } : {}),
        ...(subStreamMetadata ? { subStreamMetadata } : {}),
      });
      await provisionSubStreamPath(camera);
      return "online";
    }
    await stopRotationBridge(camera.id);

    if (camera.rtspCompatMode === "vlc-relay") {
      // See media/timestampBridge.ts: the relay's own RTSP output can't be
      // pulled directly by MediaMTX (its HLS muxer crash-loops on the
      // relay's unreliable timestamps) - publish a sanitized copy instead.
      await upsertCameraPath(camera.id, {
        source: "publisher",
        sourceOnDemand: false,
        record: camera.recordingMode === "continuous",
        recordDeleteAfter: `${camera.retentionDays}d`,
      });
      await ensureTimestampBridge(camera.id, sourceUri);
    } else {
      await stopTimestampBridge(camera.id);
      await upsertCameraPath(camera.id, {
        source: sourceUri,
        // Always keep the source connected, regardless of whether disk
        // recording is enabled. Otherwise (on-demand) MediaMTX only connects
        // to the camera/relay when a viewer opens the stream, so every first
        // load of the frontend has to wait for that connection to establish
        // (ONVIF/relay/RTSP handshake) before anything plays - by staying
        // always connected, the frontend just attaches to an already-ready
        // stream, which is instant.
        sourceOnDemand: false,
        record: camera.recordingMode === "continuous",
        rtspTransport: "tcp",
        // Per-camera retention: overrides mediamtx.yml's global pathDefaults
        // (7d) so each camera's own `retentionDays` setting actually governs
        // how long its recorded clips are kept, instead of one fixed value
        // for every camera. MediaMTX handles the actual file deletion natively.
        recordDeleteAfter: `${camera.retentionDays}d`,
      });
    }
    updateCameraConnection(camera.id, {
      rtspMainUri: rtspUri,
      status: "online",
      ...(mainStreamMetadata ? { mainStreamMetadata } : {}),
      ...(subStreamMetadata ? { subStreamMetadata } : {}),
    });
    await provisionSubStreamPath(camera);
    logger.info({ cameraId: camera.id }, "Câmera provisionada com sucesso");
    return "online";
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to provision MediaMTX stream for camera");
    updateCameraConnection(camera.id, { status: "offline" });
    return "offline";
  }
}
