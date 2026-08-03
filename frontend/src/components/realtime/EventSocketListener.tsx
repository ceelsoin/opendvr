import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { socket } from "../../api/socket";
import { useCameras } from "../../api/cameras";
import { useCameraEventStore } from "../../store/cameraEventStore";
import { useToastStore } from "../../store/toastStore";
import { friendlyEventType } from "../../lib/eventLabels";
import type { DetectionBox } from "../../api/types";

interface CameraEventPayload {
  cameraId: string;
  type: string;
  occurredAt: string;
}

interface CameraDetectionsPayload {
  cameraId: string;
  objects: DetectionBox[];
}

/**
 * Mounted once near the app root (see AppLayout). Listens for:
 * - `camera:event` (see backend/src/ws/index.ts): triggers a brief green
 *   flash around the camera's tile in GridPage, and a toast notification.
 * - `camera:detections`: feeds fresh detection boxes to the live overlay
 *   (see HlsPlayer.tsx) - broadcast on EVERY classification, independent of
 *   `camera:event`'s own debounce (see media/motionDetector.ts), so the
 *   overlay keeps refreshing for as long as something is being tracked,
 *   not just once per motion "session".
 */
export function EventSocketListener() {
  const { t } = useTranslation();
  const { data: cameras } = useCameras();
  const triggerFlash = useCameraEventStore((s) => s.triggerFlash);
  const setDetections = useCameraEventStore((s) => s.setDetections);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    function handleEvent(payload: CameraEventPayload) {
      triggerFlash(payload.cameraId);
      const cameraName = cameras?.find((c) => c.id === payload.cameraId)?.name ?? t("cameras.unknownCameraName");
      addToast("info", `${cameraName}: ${friendlyEventType(payload.type, t)}`);
    }

    function handleDetections(payload: CameraDetectionsPayload) {
      if (payload.objects?.length) {
        setDetections(payload.cameraId, payload.objects);
      }
    }

    socket.on("camera:event", handleEvent);
    socket.on("camera:detections", handleDetections);
    return () => {
      socket.off("camera:event", handleEvent);
      socket.off("camera:detections", handleDetections);
    };
  }, [cameras, triggerFlash, setDetections, addToast, t]);

  return null;
}
