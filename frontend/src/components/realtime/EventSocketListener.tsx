import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { socket } from "../../api/socket";
import { useCameras } from "../../api/cameras";
import { useCameraEventStore } from "../../store/cameraEventStore";
import { useToastStore } from "../../store/toastStore";
import { friendlyEventType } from "../../lib/eventLabels";

interface CameraEventPayload {
  cameraId: string;
  type: string;
  occurredAt: string;
}

/**
 * Mounted once near the app root (see AppLayout). Listens for the
 * `camera:event` WebSocket broadcast (see backend/src/ws/index.ts) and:
 * (1) triggers a brief green flash around the camera's tile in GridPage,
 * (2) shows a toast notification with the camera name + friendly event type.
 */
export function EventSocketListener() {
  const { t } = useTranslation();
  const { data: cameras } = useCameras();
  const triggerFlash = useCameraEventStore((s) => s.triggerFlash);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    function handleEvent(payload: CameraEventPayload) {
      triggerFlash(payload.cameraId);
      const cameraName = cameras?.find((c) => c.id === payload.cameraId)?.name ?? t("cameras.unknownCameraName");
      addToast("info", `${cameraName}: ${friendlyEventType(payload.type, t)}`);
    }

    socket.on("camera:event", handleEvent);
    return () => {
      socket.off("camera:event", handleEvent);
    };
  }, [cameras, triggerFlash, addToast, t]);

  return null;
}
