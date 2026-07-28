import type { Camera } from "../types/camera.js";
import { discoverStreams } from "../onvif/device.js";
import { upsertCameraPath } from "./mediamtx.js";
import { withRtspCredentials } from "../lib/rtsp.js";
import { ensureVlcRelay, stopVlcRelay } from "./vlcRelay.js";
import { updateCameraConnection } from "../db/cameras.repository.js";
import { logger } from "../lib/logger.js";

/**
 * (Re)connects to a camera via ONVIF (unless a pre-resolved RTSP URI is
 * already stored and a refresh wasn't requested) and (re)registers its
 * MediaMTX path. Best-effort: never throws, always persists the resulting
 * status ("online"/"offline") on the camera row.
 */
export async function provisionCamera(camera: Camera, options: { forceRefresh?: boolean } = {}): Promise<Camera["status"]> {
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
      // Cheap/OEM cameras (and containerized deployments) are more reliable
      // over TCP; UDP is more prone to packet loss/NAT issues that show up
      // as a stuck/never-ready path even though the camera is reachable.
      // EXCEPTION: the VLC relay's own RTSP output (#rtp{sdp=...}) only
      // serves over UDP - forcing TCP against it fails with "461 Unsupported
      // transport". This hop is container-to-container on the same docker
      // network though (no real NAT/packet-loss concern), so UDP is safe here.
      rtspTransport: camera.rtspCompatMode === "vlc-relay" ? "udp" : "tcp",
      // Per-camera retention: overrides mediamtx.yml's global pathDefaults
      // (7d) so each camera's own `retentionDays` setting actually governs
      // how long its recorded clips are kept, instead of one fixed value
      // for every camera. MediaMTX handles the actual file deletion natively.
      recordDeleteAfter: `${camera.retentionDays}d`,
    });
    updateCameraConnection(camera.id, {
      rtspMainUri: rtspUri,
      status: "online",
      ...(mainStreamMetadata ? { mainStreamMetadata } : {}),
      ...(subStreamMetadata ? { subStreamMetadata } : {}),
    });
    return "online";
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to provision MediaMTX stream for camera");
    updateCameraConnection(camera.id, { status: "offline" });
    return "offline";
  }
}
