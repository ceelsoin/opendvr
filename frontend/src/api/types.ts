export type CameraStatus = "online" | "offline" | "unknown";

/**
 * "vlc-relay": camera flagged as having an RTSP server incompatible with
 * MediaMTX's client (some cheap cameras only validate Digest auth retried on
 * the same TCP connection as the 401 challenge). A VLC relay process is used
 * as a compatibility bridge instead - see backend/src/media/vlcRelay.ts.
 */
export type RtspCompatMode = "vlc-relay" | null;

/**
 * "off": no disk recording. "continuous": always recording. "motion":
 * recording starts reactively on an ONVIF motion event and stops after a
 * cooldown period with no further events.
 */
export type RecordingMode = "off" | "continuous" | "motion";

/**
 * "onvif": motion alerts/recording driven by the camera's own ONVIF
 * PullPoint events (default). "video": driven by local OpenCV analysis of
 * the RTSP stream instead - useful for cameras whose ONVIF Events service
 * doesn't actually work despite advertising support.
 */
export type MotionDetectionSource = "onvif" | "video";

/**
 * Which protocol/mechanism is used for this camera's video source - see the
 * backend's types/camera.ts for the full rationale. "onvif" is the
 * original/default full flow (discovery, PTZ, events, snapshot). Any other
 * value is a directly-entered URL of that protocol, with ONVIF fields
 * (host/port/onvifPath/username/password) only used - optionally - for PTZ.
 */
export type CameraSourceType = "onvif" | "rtsp" | "rtmp" | "hls" | "srt" | "mjpeg-http" | "webpage";

/** Clockwise video rotation applied before the stream reaches MediaMTX (0 = no rotation, no transcoding). */
export type CameraRotation = 0 | 90 | 180 | 270;

/** Optional downscale applied by the same transcode bridge used for rotation/forced-H.264, "original" = no scaling. Only has an effect while that bridge is running. */
export type TranscodeResolution = "original" | "720" | "480" | "360";

/** ONVIF-discovered resolution/codec info for a stream, saved so the edit form can show it again without re-probing. */
export interface StreamMetadata {
  width: number | null;
  height: number | null;
  encoding: string | null;
}

/** Optional "zone of interest" polygon for object-detection filtering, normalized 0..1 on both axes. */
export interface DetectionZone {
  points: Array<[number, number]>;
}

/** The 4 categories the shared YOLO worker can classify a detection as. */
export type DetectionCategory = "person" | "vehicle" | "animal" | "other";

export interface Camera {
  id: string;
  name: string;
  sourceType: CameraSourceType;
  host: string;
  port: number;
  onvifPath: string;
  username: string;
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
  /** Forces the transcode bridge to re-encode this camera's video as H.264, e.g. for clients that can't decode a source that's actually H.265/HEVC. */
  transcodeToH264: boolean;
  transcodeResolution: TranscodeResolution;
  recordingMode: RecordingMode;
  motionRecording: boolean;
  motionDetectionSource: MotionDetectionSource;
  /** AI object detection (YOLO), gated behind an existing motion signal. */
  objectDetectionEnabled: boolean;
  /** Face recognition, only ever runs on frames already classified as "person" by object detection. */
  faceRecognitionEnabled: boolean;
  detectionZone: DetectionZone | null;
  /** Which detected categories actually generate an event - null/empty means all of them. */
  detectionCategories: DetectionCategory[] | null;
  retentionDays: number;
  status: CameraStatus;
  /** Administrative on/off switch, independent of `status` (connectivity). */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCameraInput {
  name: string;
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
  transcodeToH264?: boolean;
  transcodeResolution?: TranscodeResolution;
  recordingMode?: RecordingMode;
  motionRecording?: boolean;
  motionDetectionSource?: MotionDetectionSource;
  objectDetectionEnabled?: boolean;
  faceRecognitionEnabled?: boolean;
  detectionZone?: DetectionZone | null;
  detectionCategories?: DetectionCategory[] | null;
  retentionDays?: number;
}

export type UpdateCameraInput = Partial<CreateCameraInput>;

export interface DiscoveredStream {
  profileToken: string;
  name: string;
  encoding: string | null;
  width: number | null;
  height: number | null;
  rtspUri: string;
}

export interface OnvifProbeResult {
  host: string;
  port: number;
  onvifPath: string;
  username: string;
  streams: DiscoveredStream[];
}

export interface DiscoveredCamera {
  hostname: string;
  port: number;
  urn: string | null;
  xaddrs: string[];
}

export interface Recording {
  id: string;
  camera_id: string;
  file_path: string;
  start_time: string;
  end_time: string | null;
  kind: string;
}

export interface CameraEvent {
  id: string;
  camera_id: string;
  type: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
  read: boolean;
  snapshotUrl: string | null;
  caption: string | null;
}

/** A user-defined camera grid: column count ("formato") + an ordered list of camera IDs ("ordem"/"câmeras"). */
export interface CustomGrid {
  id: string;
  name: string;
  columns: number;
  cameraIds: string[];
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGridInput {
  name: string;
  columns?: number;
  cameraIds: string[];
  isPublic?: boolean;
}

export type UpdateGridInput = Partial<CreateGridInput>;

/** Credential-free camera shape served by GET /grids/:id/public - see backend/src/types/grid.ts. */
export interface PublicGridCamera {
  id: string;
  name: string;
  rotation: 0 | 90 | 180 | 270;
  hasSubStream: boolean;
}

export interface PublicGrid {
  id: string;
  name: string;
  columns: number;
  cameras: PublicGridCamera[];
}

