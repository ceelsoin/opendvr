import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import type { Camera, CameraPublic, CreateCameraInput, UpdateCameraInput } from "../types/camera.js";

interface CameraRow {
  id: string;
  name: string;
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
  recording_mode: Camera["recordingMode"];
  motion_recording: number;
  motion_detection_source: Camera["motionDetectionSource"];
  retention_days: number;
  status: Camera["status"];
  created_at: string;
  updated_at: string;
}

function toCamera(row: CameraRow): Camera {
  return {
    id: row.id,
    name: row.name,
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
    recordingMode: row.recording_mode,
    motionRecording: Boolean(row.motion_recording),
    motionDetectionSource: row.motion_detection_source,
    retentionDays: row.retention_days,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
      id, name, host, port, onvif_path, username, password,
      rtsp_main_uri, rtsp_sub_uri, onvif_profile_token, onvif_sub_profile_token,
      rtsp_compat_mode, main_stream_width, main_stream_height, main_stream_encoding,
      sub_stream_width, sub_stream_height, sub_stream_encoding, has_ptz,
      recording_mode, motion_recording, motion_detection_source, retention_days
    ) VALUES (
      @id, @name, @host, @port, @onvifPath, @username, @password,
      @rtspMainUri, @rtspSubUri, @mainProfileToken, @subProfileToken,
      @rtspCompatMode, @mainStreamWidth, @mainStreamHeight, @mainStreamEncoding,
      @subStreamWidth, @subStreamHeight, @subStreamEncoding, @hasPtz,
      @recordingMode, @motionRecording, @motionDetectionSource, @retentionDays
    )`
  ).run({
    id,
    name: input.name,
    host: input.host,
    port: input.port ?? 80,
    onvifPath: input.onvifPath ?? "/onvif/device_service",
    username: input.username,
    password: input.password,
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
    recordingMode: input.recordingMode ?? "off",
    motionRecording: input.motionRecording === false ? 0 : 1,
    // Defaults to "video" (OpenCV analysis) rather than "onvif": PullPoint
    // events turned out to be unreliable/broken on several cheap OEM
    // cameras despite advertising support (see /memories/repo notes), so
    // the more universally-reliable option is the sane default for newly
    // created cameras going forward. Existing rows keep whatever they had.
    motionDetectionSource: input.motionDetectionSource ?? "video",
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
    ["recordingMode", "recording_mode", (v) => v],
    ["motionRecording", "motion_recording", (v) => (v ? 1 : 0)],
    ["motionDetectionSource", "motion_detection_source", (v) => v],
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
