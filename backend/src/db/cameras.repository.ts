import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import type { Camera, CameraCapabilities, CameraPublic, CreateCameraInput, UpdateCameraInput } from "../types/camera.js";

interface CameraRow {
  id: string;
  name: string;
  source_type: Camera["sourceType"];
  host: string;
  port: number;
  onvif_path: string;
  username: string;
  password: string;
  rtsp_main_uri: string | null;
  rtsp_sub_uri: string | null;
  onvif_profile_token: string | null;
  onvif_sub_profile_token: string | null;
  rtsp_compat_mode: string | null;
  main_stream_width: number | null;
  main_stream_height: number | null;
  main_stream_encoding: string | null;
  sub_stream_width: number | null;
  sub_stream_height: number | null;
  sub_stream_encoding: string | null;
  has_ptz: number;
  rotation: Camera["rotation"];
  transcode_to_h264: number;
  transcode_resolution: Camera["transcodeResolution"];
  recording_mode: Camera["recordingMode"];
  motion_recording: number;
  motion_detection_source: Camera["motionDetectionSource"];
  object_detection_enabled: number;
  face_recognition_enabled: number;
  annotate_event_snapshots: number;
  detection_zone: string | null;
  detection_categories: string | null;
  retention_days: number;
  status: Camera["status"];
  enabled: number;
  created_at: string;
  updated_at: string;
  capabilities: string | null;
}

function toCamera(row: CameraRow): Camera {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    host: row.host,
    port: row.port,
    onvifPath: row.onvif_path,
    username: row.username,
    password: row.password,
    rtspMainUri: row.rtsp_main_uri,
    rtspSubUri: row.rtsp_sub_uri,
    onvifProfileToken: row.onvif_profile_token,
    onvifSubProfileToken: row.onvif_sub_profile_token,
    rtspCompatMode: row.rtsp_compat_mode as Camera["rtspCompatMode"],
    mainStreamWidth: row.main_stream_width,
    mainStreamHeight: row.main_stream_height,
    mainStreamEncoding: row.main_stream_encoding,
    subStreamWidth: row.sub_stream_width,
    subStreamHeight: row.sub_stream_height,
    subStreamEncoding: row.sub_stream_encoding,
    hasPtz: Boolean(row.has_ptz),
    rotation: row.rotation,
    transcodeToH264: Boolean(row.transcode_to_h264),
    transcodeResolution: row.transcode_resolution,
    recordingMode: row.recording_mode,
    motionRecording: Boolean(row.motion_recording),
    motionDetectionSource: row.motion_detection_source,
    objectDetectionEnabled: Boolean(row.object_detection_enabled),
    faceRecognitionEnabled: Boolean(row.face_recognition_enabled),
    annotateEventSnapshots: Boolean(row.annotate_event_snapshots),
    detectionZone: row.detection_zone ? JSON.parse(row.detection_zone) : null,
    detectionCategories: row.detection_categories ? JSON.parse(row.detection_categories) : null,
    retentionDays: row.retention_days,
    status: row.status,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : null,
  };
}

export function toPublicCamera(camera: Camera): CameraPublic {
  const { password: _password, ...publicCamera } = camera;
  return publicCamera;
}

export function listCameras(): Camera[] {
  const rows = db.prepare("SELECT * FROM cameras ORDER BY name ASC").all() as CameraRow[];
  return rows.map(toCamera);
}

export function getCameraById(id: string): Camera | null {
  const row = db.prepare("SELECT * FROM cameras WHERE id = ?").get(id) as CameraRow | undefined;
  return row ? toCamera(row) : null;
}

export function createCamera(input: CreateCameraInput): Camera {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO cameras (
      id, name, source_type, host, port, onvif_path, username, password,
      rtsp_main_uri, rtsp_sub_uri, onvif_profile_token, onvif_sub_profile_token,
      rtsp_compat_mode, main_stream_width, main_stream_height, main_stream_encoding,
      sub_stream_width, sub_stream_height, sub_stream_encoding, has_ptz, rotation,
      transcode_to_h264, transcode_resolution,
      recording_mode, motion_recording, motion_detection_source,
      object_detection_enabled, face_recognition_enabled, annotate_event_snapshots, detection_zone, detection_categories, retention_days
    ) VALUES (
      @id, @name, @sourceType, @host, @port, @onvifPath, @username, @password,
      @rtspMainUri, @rtspSubUri, @mainProfileToken, @subProfileToken,
      @rtspCompatMode, @mainStreamWidth, @mainStreamHeight, @mainStreamEncoding,
      @subStreamWidth, @subStreamHeight, @subStreamEncoding, @hasPtz, @rotation,
      @transcodeToH264, @transcodeResolution,
      @recordingMode, @motionRecording, @motionDetectionSource,
      @objectDetectionEnabled, @faceRecognitionEnabled, @annotateEventSnapshots, @detectionZone, @detectionCategories, @retentionDays
    )`
  ).run({
    id,
    name: input.name,
    sourceType: input.sourceType ?? "onvif",
    host: input.host ?? "",
    port: input.port ?? 80,
    onvifPath: input.onvifPath ?? "/onvif/device_service",
    username: input.username ?? "",
    password: input.password ?? "",
    rtspMainUri: input.rtspMainUri ?? null,
    rtspSubUri: input.rtspSubUri ?? null,
    mainProfileToken: input.mainProfileToken ?? null,
    subProfileToken: input.subProfileToken ?? null,
    rtspCompatMode: input.rtspCompatMode ?? null,
    mainStreamWidth: input.mainStreamMetadata?.width ?? null,
    mainStreamHeight: input.mainStreamMetadata?.height ?? null,
    mainStreamEncoding: input.mainStreamMetadata?.encoding ?? null,
    subStreamWidth: input.subStreamMetadata?.width ?? null,
    subStreamHeight: input.subStreamMetadata?.height ?? null,
    subStreamEncoding: input.subStreamMetadata?.encoding ?? null,
    hasPtz: input.hasPtz ? 1 : 0,
    rotation: input.rotation ?? 0,
    transcodeToH264: input.transcodeToH264 ? 1 : 0,
    transcodeResolution: input.transcodeResolution ?? "original",
    recordingMode: input.recordingMode ?? "off",
    motionRecording: input.motionRecording === false ? 0 : 1,
    // Defaults to "video" (OpenCV analysis) rather than "onvif": PullPoint
    // events turned out to be unreliable/broken on several cheap OEM
    // cameras despite advertising support (see /memories/repo notes), so
    // the more universally-reliable option is the sane default for newly
    // created cameras going forward. Existing rows keep whatever they had.
    motionDetectionSource: input.motionDetectionSource ?? "video",
    objectDetectionEnabled: input.objectDetectionEnabled ? 1 : 0,
    faceRecognitionEnabled: input.faceRecognitionEnabled ? 1 : 0,
    annotateEventSnapshots: input.annotateEventSnapshots ? 1 : 0,
    detectionZone: input.detectionZone ? JSON.stringify(input.detectionZone) : null,
    detectionCategories: input.detectionCategories ? JSON.stringify(input.detectionCategories) : null,
    retentionDays: input.retentionDays ?? 7,
  });
  const camera = getCameraById(id);
  if (!camera) {
    throw new Error("Failed to load camera after creation");
  }
  return camera;
}

export function updateCamera(id: string, input: UpdateCameraInput): Camera | null {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };

  const setters: Array<[keyof UpdateCameraInput, string, (v: unknown) => unknown]> = [
    ["name", "name", (v) => v],
    ["sourceType", "source_type", (v) => v],
    ["host", "host", (v) => v],
    ["port", "port", (v) => v],
    ["onvifPath", "onvif_path", (v) => v],
    ["username", "username", (v) => v],
    ["password", "password", (v) => v],
    ["rtspMainUri", "rtsp_main_uri", (v) => v],
    ["rtspSubUri", "rtsp_sub_uri", (v) => v],
    ["mainProfileToken", "onvif_profile_token", (v) => v],
    ["subProfileToken", "onvif_sub_profile_token", (v) => v],
    ["rtspCompatMode", "rtsp_compat_mode", (v) => v],
    ["hasPtz", "has_ptz", (v) => (v ? 1 : 0)],
    ["rotation", "rotation", (v) => v],
    ["transcodeToH264", "transcode_to_h264", (v) => (v ? 1 : 0)],
    ["transcodeResolution", "transcode_resolution", (v) => v],
    ["recordingMode", "recording_mode", (v) => v],
    ["motionRecording", "motion_recording", (v) => (v ? 1 : 0)],
    ["motionDetectionSource", "motion_detection_source", (v) => v],
    ["objectDetectionEnabled", "object_detection_enabled", (v) => (v ? 1 : 0)],
    ["faceRecognitionEnabled", "face_recognition_enabled", (v) => (v ? 1 : 0)],
    ["annotateEventSnapshots", "annotate_event_snapshots", (v) => (v ? 1 : 0)],
    ["retentionDays", "retention_days", (v) => v],
  ];

  for (const [inputKey, column, transform] of setters) {
    const value = input[inputKey];
    if (value !== undefined) {
      const paramKey = column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      fields.push(`${column} = @${paramKey}`);
      params[paramKey] = transform(value);
    }
  }

  // detectionZone (an object/null) needs JSON (de)serialization, so it
  // doesn't fit the 1:1 setters loop above either.
  if (input.detectionZone !== undefined) {
    fields.push("detection_zone = @detectionZone");
    params.detectionZone = input.detectionZone ? JSON.stringify(input.detectionZone) : null;
  }

  // Same reason as detectionZone above (array/null needs JSON (de)serialization).
  if (input.detectionCategories !== undefined) {
    fields.push("detection_categories = @detectionCategories");
    params.detectionCategories = input.detectionCategories ? JSON.stringify(input.detectionCategories) : null;
  }

  // Stream metadata is one input object mapping to 3 columns each, so it
  // doesn't fit the 1:1 setters loop above.
  if (input.mainStreamMetadata !== undefined) {
    fields.push("main_stream_width = @mainStreamWidth", "main_stream_height = @mainStreamHeight", "main_stream_encoding = @mainStreamEncoding");
    params.mainStreamWidth = input.mainStreamMetadata?.width ?? null;
    params.mainStreamHeight = input.mainStreamMetadata?.height ?? null;
    params.mainStreamEncoding = input.mainStreamMetadata?.encoding ?? null;
  }
  if (input.subStreamMetadata !== undefined) {
    fields.push("sub_stream_width = @subStreamWidth", "sub_stream_height = @subStreamHeight", "sub_stream_encoding = @subStreamEncoding");
    params.subStreamWidth = input.subStreamMetadata?.width ?? null;
    params.subStreamHeight = input.subStreamMetadata?.height ?? null;
    params.subStreamEncoding = input.subStreamMetadata?.encoding ?? null;
  }

  if (fields.length === 0) {
    return getCameraById(id);
  }

  db.prepare(`UPDATE cameras SET ${fields.join(", ")}, updated_at = datetime('now') WHERE id = @id`).run(params);
  return getCameraById(id);
}

export function deleteCamera(id: string): boolean {
  const result = db.prepare("DELETE FROM cameras WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateCameraStatus(id: string, status: Camera["status"]): void {
  db.prepare(
    "UPDATE cameras SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
}

/** Administrative on/off switch - see cameras.routes.ts's /enable and /disable actions. */
export function setCameraEnabled(id: string, enabled: boolean): Camera | null {
  db.prepare(
    "UPDATE cameras SET enabled = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(enabled ? 1 : 0, id);
  return getCameraById(id);
}

/** Persists the result of an ONVIF capability probe (see onvif/capabilityResolver.ts) - called after create and after a manual "redetect" action. */
export function updateCameraCapabilities(id: string, capabilities: CameraCapabilities): Camera | null {
  db.prepare(
    "UPDATE cameras SET capabilities = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(capabilities), id);
  return getCameraById(id);
}

interface CameraConnectionUpdate {
  rtspMainUri?: string | null;
  status?: Camera["status"];
  mainStreamMetadata?: { width: number | null; height: number | null; encoding: string | null } | null;
  subStreamMetadata?: { width: number | null; height: number | null; encoding: string | null } | null;
}

/** Persists the results of provisioning a camera's stream (ONVIF + MediaMTX). */
export function updateCameraConnection(id: string, data: CameraConnectionUpdate): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };

  if (data.rtspMainUri !== undefined) {
    fields.push("rtsp_main_uri = @rtspMainUri");
    params.rtspMainUri = data.rtspMainUri;
  }
  if (data.status !== undefined) {
    fields.push("status = @status");
    params.status = data.status;
  }
  if (data.mainStreamMetadata !== undefined) {
    fields.push(
      "main_stream_width = @mainStreamWidth",
      "main_stream_height = @mainStreamHeight",
      "main_stream_encoding = @mainStreamEncoding"
    );
    params.mainStreamWidth = data.mainStreamMetadata?.width ?? null;
    params.mainStreamHeight = data.mainStreamMetadata?.height ?? null;
    params.mainStreamEncoding = data.mainStreamMetadata?.encoding ?? null;
  }
  if (data.subStreamMetadata !== undefined) {
    fields.push(
      "sub_stream_width = @subStreamWidth",
      "sub_stream_height = @subStreamHeight",
      "sub_stream_encoding = @subStreamEncoding"
    );
    params.subStreamWidth = data.subStreamMetadata?.width ?? null;
    params.subStreamHeight = data.subStreamMetadata?.height ?? null;
    params.subStreamEncoding = data.subStreamMetadata?.encoding ?? null;
  }
  if (fields.length === 0) {
    return;
  }

  db.prepare(`UPDATE cameras SET ${fields.join(", ")}, updated_at = datetime('now') WHERE id = @id`).run(params);
}
