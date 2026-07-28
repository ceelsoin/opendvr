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

/** ONVIF-discovered resolution/codec info for a stream, saved so the edit form can show it again without re-probing. */
export interface StreamMetadata {
  width: number | null;
  height: number | null;
  encoding: string | null;
}

export interface Camera {
  id: string;
  name: string;
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
  recordingMode: RecordingMode;
  motionRecording: boolean;
  motionDetectionSource: MotionDetectionSource;
  retentionDays: number;
  status: CameraStatus;
  createdAt: string;
  updatedAt: string;
}

export type CameraPublic = Omit<Camera, "password">;

export interface CreateCameraInput {
  name: string;
  host: string;
  port?: number;
  onvifPath?: string;
  username: string;
  password: string;
  /** Pre-resolved via /api/onvif/probe, so creation doesn't need to reconnect. */
  mainProfileToken?: string;
  subProfileToken?: string;
  rtspMainUri?: string;
  rtspSubUri?: string;
  rtspCompatMode?: RtspCompatMode;
  mainStreamMetadata?: StreamMetadata;
  subStreamMetadata?: StreamMetadata;
  hasPtz?: boolean;
  recordingMode?: RecordingMode;
  motionRecording?: boolean;
  motionDetectionSource?: MotionDetectionSource;
  retentionDays?: number;
}

export interface UpdateCameraInput {
  name?: string;
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
  recordingMode?: RecordingMode;
  motionRecording?: boolean;
  motionDetectionSource?: MotionDetectionSource;
  retentionDays?: number;
}
