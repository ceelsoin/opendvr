import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db, runMigrations } from "../db/client.js";
import {
  createCamera,
  getCameraById,
  listCameras,
  updateCamera,
  deleteCamera,
  setCameraEnabled,
  updateCameraConnection,
  toPublicCamera,
} from "./cameras.repository.js";

describe("cameras.repository", () => {
  beforeAll(() => {
    runMigrations();
  });

  afterEach(() => {
    db.exec("DELETE FROM cameras");
  });

  describe("createCamera", () => {
    it("creates a camera with sane defaults when optional fields are omitted", () => {
      const camera = createCamera({ name: "Quintal" });

      expect(camera.name).toBe("Quintal");
      expect(camera.sourceType).toBe("onvif");
      expect(camera.host).toBe("");
      expect(camera.port).toBe(80);
      expect(camera.onvifPath).toBe("/onvif/device_service");
      expect(camera.hasPtz).toBe(false);
      expect(camera.rotation).toBe(0);
      expect(camera.recordingMode).toBe("off");
      expect(camera.motionRecording).toBe(true);
      expect(camera.motionDetectionSource).toBe("video");
      expect(camera.retentionDays).toBe(7);
      expect(camera.discordNotificationsEnabled).toBe(true);
      expect(camera.enabled).toBe(true);
      expect(camera.status).toBe("unknown");
      expect(camera.id).toBeTruthy();
    });

    it("persists every explicitly provided field, including rotation and hasPtz", () => {
      const camera = createCamera({
        name: "Garagem",
        sourceType: "rtsp",
        host: "192.168.1.35",
        port: 554,
        username: "admin",
        password: "secret",
        rtspMainUri: "rtsp://192.168.1.35:554/onvif1",
        hasPtz: true,
        rotation: 90,
        recordingMode: "continuous",
        retentionDays: 14,
      });

      expect(camera.sourceType).toBe("rtsp");
      expect(camera.host).toBe("192.168.1.35");
      expect(camera.port).toBe(554);
      expect(camera.username).toBe("admin");
      expect(camera.password).toBe("secret");
      expect(camera.rtspMainUri).toBe("rtsp://192.168.1.35:554/onvif1");
      expect(camera.hasPtz).toBe(true);
      expect(camera.rotation).toBe(90);
      expect(camera.recordingMode).toBe("continuous");
      expect(camera.retentionDays).toBe(14);
    });

    it("stores stream metadata for both main and sub streams", () => {
      const camera = createCamera({
        name: "Entrada",
        mainStreamMetadata: { width: 1920, height: 1080, encoding: "H264" },
        subStreamMetadata: { width: 640, height: 360, encoding: "H264" },
      });

      expect(camera.mainStreamWidth).toBe(1920);
      expect(camera.mainStreamHeight).toBe(1080);
      expect(camera.mainStreamEncoding).toBe("H264");
      expect(camera.subStreamWidth).toBe(640);
      expect(camera.subStreamHeight).toBe(360);
      expect(camera.subStreamEncoding).toBe("H264");
    });
  });

  describe("getCameraById / listCameras", () => {
    it("returns null for a nonexistent id", () => {
      expect(getCameraById("does-not-exist")).toBeNull();
    });

    it("lists all cameras ordered by name", () => {
      createCamera({ name: "Zebra" });
      createCamera({ name: "Alpha" });
      createCamera({ name: "Mango" });

      const names = listCameras().map((c) => c.name);
      expect(names).toEqual(["Alpha", "Mango", "Zebra"]);
    });
  });

  describe("updateCamera", () => {
    it("updates only the fields provided, leaving the rest untouched", () => {
      const camera = createCamera({ name: "Quintal", rotation: 0, hasPtz: false });

      const updated = updateCamera(camera.id, { rotation: 180 });

      expect(updated?.rotation).toBe(180);
      expect(updated?.name).toBe("Quintal");
      expect(updated?.hasPtz).toBe(false);
    });

    it("returns the unchanged camera when the input is empty", () => {
      const camera = createCamera({ name: "Quintal" });
      const updated = updateCamera(camera.id, {});
      expect(updated).toEqual(camera);
    });

    it("returns null when updating a nonexistent camera", () => {
      expect(updateCamera("nonexistent-id", { name: "X" })).toBeNull();
    });

    it("updates stream metadata as a group", () => {
      const camera = createCamera({ name: "Quintal" });
      const updated = updateCamera(camera.id, {
        mainStreamMetadata: { width: 1280, height: 720, encoding: "H265" },
      });
      expect(updated?.mainStreamWidth).toBe(1280);
      expect(updated?.mainStreamHeight).toBe(720);
      expect(updated?.mainStreamEncoding).toBe("H265");
    });

    it("correctly coerces boolean fields (hasPtz/motionRecording) to integers and back", () => {
      const camera = createCamera({ name: "Quintal", hasPtz: false });
      const updated = updateCamera(camera.id, { hasPtz: true, motionRecording: false });
      expect(updated?.hasPtz).toBe(true);
      expect(updated?.motionRecording).toBe(false);
    });

    it("persists the per-camera Discord notification toggle", () => {
      const camera = createCamera({ name: "Quintal", discordNotificationsEnabled: false });
      expect(camera.discordNotificationsEnabled).toBe(false);

      const updated = updateCamera(camera.id, { discordNotificationsEnabled: true });
      expect(updated?.discordNotificationsEnabled).toBe(true);
    });

    it("bumps updated_at without touching created_at", () => {
      const camera = createCamera({ name: "Quintal" });
      const updated = updateCamera(camera.id, { name: "Quintal 2" });
      expect(updated?.createdAt).toBe(camera.createdAt);
      expect(updated?.updatedAt).toBeTruthy();
    });
  });

  describe("deleteCamera", () => {
    it("deletes an existing camera and returns true", () => {
      const camera = createCamera({ name: "Temp" });
      expect(deleteCamera(camera.id)).toBe(true);
      expect(getCameraById(camera.id)).toBeNull();
    });

    it("returns false when deleting a nonexistent camera", () => {
      expect(deleteCamera("nonexistent-id")).toBe(false);
    });
  });

  describe("setCameraEnabled", () => {
    it("toggles the enabled flag independently of status", () => {
      const camera = createCamera({ name: "Quintal" });
      expect(camera.enabled).toBe(true);

      const disabled = setCameraEnabled(camera.id, false);
      expect(disabled?.enabled).toBe(false);
      expect(disabled?.status).toBe(camera.status);

      const reEnabled = setCameraEnabled(camera.id, true);
      expect(reEnabled?.enabled).toBe(true);
    });
  });

  describe("updateCameraConnection", () => {
    it("persists the resolved RTSP URI, status, and stream metadata from a successful provision", () => {
      const camera = createCamera({ name: "Quintal" });
      updateCameraConnection(camera.id, {
        rtspMainUri: "rtsp://192.168.1.48:554/onvif1",
        status: "online",
        mainStreamMetadata: { width: 1920, height: 1080, encoding: "H264" },
      });

      const reloaded = getCameraById(camera.id);
      expect(reloaded?.rtspMainUri).toBe("rtsp://192.168.1.48:554/onvif1");
      expect(reloaded?.status).toBe("online");
      expect(reloaded?.mainStreamWidth).toBe(1920);
    });

    it("marks a camera offline when provisioning fails, without touching its saved RTSP URI", () => {
      const camera = createCamera({ name: "Quintal" });
      updateCameraConnection(camera.id, { rtspMainUri: "rtsp://192.168.1.48:554/onvif1", status: "online" });
      updateCameraConnection(camera.id, { status: "offline" });

      const reloaded = getCameraById(camera.id);
      expect(reloaded?.status).toBe("offline");
      expect(reloaded?.rtspMainUri).toBe("rtsp://192.168.1.48:554/onvif1");
    });
  });

  describe("toPublicCamera", () => {
    it("strips the password field but keeps everything else", () => {
      const camera = createCamera({ name: "Quintal", password: "super-secret" });
      const pub = toPublicCamera(camera);

      expect(pub).not.toHaveProperty("password");
      expect(pub.name).toBe("Quintal");
      expect(pub.id).toBe(camera.id);
    });
  });
});
