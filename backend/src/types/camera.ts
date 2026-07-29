export type CameraStatus = "online" | "offline" | "unknown";

/**
 * "vlc-relay": the camera's RTSP server is incompatible with MediaMTX's Go
 * RTSP client (e.g. it only accepts Digest auth retried on the SAME TCP
 * connection as the 401 challenge). A headless VLC process (which uses the
 * live555 client, known to be tolerant of this) pulls the stream once and
 * re-serves it as a plain RTSP source that MediaMTX then consumes normally.
 */
export type RtspCompatMode = "vlc-relay" | null;

/**
 * "off": no disk recording. "continuous": MediaMTX records the whole time.
 * "motion": recording starts reactively when an ONVIF motion event fires
 * and stops after a cooldown with no further events (see
 * media/motionRecording.ts). Replaces the old binary continuousRecording
 * checkbox.
 */
export type RecordingMode = "off" | "continuous" | "motion";

/**
 * "onvif": motion alerts/recording driven by the camera's own ONVIF
 * PullPoint events (default). "video": driven by local OpenCV analysis of
 * the RTSP stream instead (media/motionDetector.ts) - needed for cameras
 * whose ONVIF Events service is broken despite advertising support.
 */
export type MotionDetectionSource = "onvif" | "video";

/**
 * Which protocol/mechanism is used to pull (or, for "onvif", resolve then
 * pull) this camera's video:
 *  - "onvif": full ONVIF flow (device discovery, profile/stream resolution,
 *    PullPoint events, GetSnapshotUri) - the original/default behavior.
 *  - "rtsp": a plain RTSP URL entered directly (`rtspMainUri`), no ONVIF
 *    involved for video at all - optionally still using ONVIF `host`/
 *    `port`/`onvifPath`/`username`/`password`/`onvifProfileToken` purely for
 *    PTZ control, if `hasPtz` is set (see media/ptzCamera.ts).
 *  - "rtmp" / "hls" / "srt": likewise a directly-entered URL of that
 *    protocol, pulled by MediaMTX natively (no transcoding bridge needed -
 *    see mediamtx.yml's documented `source:` URL schemes).
 * For any non-"onvif" type, motion detection is always video-based (OpenCV)
 * since there's no ONVIF Events subscription for the video connection
 * itself, and snapshots always use the ffmpeg/MediaMTX fallback instead of
 * ONVIF's GetSnapshotUri (unless PTZ-hybrid ONVIF fields are set, which
 * doesn't change this - snapshot still prefers the cheaper ffmpeg route).
 *  - "mjpeg-http": an MJPEG-over-HTTP camera (`rtspMainUri` holds the http(s)
 *    URL, despite the field name) - bridged into RTSP via ffmpeg, see
 *    media/mjpegBridge.ts.
 *  - "webpage": an arbitrary web page (`rtspMainUri` holds the http(s) URL)
 *    rendered by a headless Chromium and captured as a video feed - see
 *    media/webpageBridge.ts. By far the heaviest source type (runs a real
 *    browser engine).
 */
export type CameraSourceType = "onvif" | "rtsp" | "rtmp" | "hls" | "srt" | "mjpeg-http" | "webpage";

/**
 * Clockwise video rotation applied before the stream reaches MediaMTX, for
 * cameras physically mounted in a non-upright orientation. 0 (the default)
 * means no rotation - MediaMTX pulls/relays the stream as-is, no
 * transcoding involved. Any other value forces a transcode bridge (see
 * media/rotationBridge.ts for "onvif"/"rtsp"/"rtmp"/"hls"/"srt", or the
 * rotation filter added directly to the existing ffmpeg bridge for
 * "mjpeg-http"/"webpage") since rotating pixels requires a real decode +
 * re-encode - MediaMTX itself has no video-filter capability.
 */
export type CameraRotation = 0 | 90 | 180 | 270;

/** ONVIF-discovered resolution/codec info for a stream, saved so the edit form can show it again without re-probing. */
export interface StreamMetadata {
  width: number | null;
  height: number | null;
  encoding: string | null;
}

export interface Camera {
  id: string;
  name: string;
  sourceType: CameraSourceType;
  host: string;
  port: number;
  /** ONVIF device service path, e.g. "/onvif/device_service" or "/onvif". */
  onvifPath: string;
  username: string;
  /** Stored encrypted at rest; never sent back to the client. */
  password: string;
  rtspMainUri: string | null;
  rtspSubUri: string | null;
  onvifProfileToken: string | null;
  onvifSubProfileToken: string | null;
  rtspCompatMode: RtspCompatMode;
  mainStreamWidth: number | null;
  mainStreamHeight: number | null;
  mainStreamEncoding: string | null;
  subStreamWidth: number | null;
  subStreamHeight: number | null;
  subStreamEncoding: string | null;
  hasPtz: boolean;
  rotation: CameraRotation;
  recordingMode: RecordingMode;
  motionRecording: boolean;
  motionDetectionSource: MotionDetectionSource;
  retentionDays: number;
  status: CameraStatus;
  /** Administrative on/off switch, independent of `status` (connectivity). See media/provisioning.ts callers in cameras.routes.ts's enable/disable actions. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CameraPublic = Omit<Camera, "password">;

export interface CreateCameraInput {
  name: string;
  sourceType?: CameraSourceType;
  host?: string;
  port?: number;
  onvifPath?: string;
  username?: string;
  password?: string;
  /** Pre-resolved via /api/onvif/probe, so creation doesn't need to reconnect. */
  mainProfileToken?: string;
  subProfileToken?: string;
  rtspMainUri?: string;
  rtspSubUri?: string;
  rtspCompatMode?: RtspCompatMode;
  mainStreamMetadata?: StreamMetadata;
  subStreamMetadata?: StreamMetadata;
  hasPtz?: boolean;
  rotation?: CameraRotation;
  recordingMode?: RecordingMode;
  motionRecording?: boolean;
  motionDetectionSource?: MotionDetectionSource;
  retentionDays?: number;
}

export interface UpdateCameraInput {
  name?: string;
  sourceType?: CameraSourceType;
  host?: string;
  port?: number;
  onvifPath?: string;
  username?: string;
  password?: string;
  mainProfileToken?: string;
  subProfileToken?: string;
  rtspMainUri?: string;
  rtspSubUri?: string;
  rtspCompatMode?: RtspCompatMode;
  mainStreamMetadata?: StreamMetadata;
  subStreamMetadata?: StreamMetadata;
  hasPtz?: boolean;
  rotation?: CameraRotation;
  recordingMode?: RecordingMode;
  motionRecording?: boolean;
  motionDetectionSource?: MotionDetectionSource;
  retentionDays?: number;
}
