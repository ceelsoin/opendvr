/** Human-friendly translation for common ONVIF event topic suffixes (mirrors backend/src/notifications/webhooks.ts). */
export function friendlyEventType(topic: string, t: (key: string) => string): string {
  const lower = topic.toLowerCase();
  if (lower === "object:person") return t("eventTypes.personDetected");
  if (lower === "object:vehicle") return t("eventTypes.vehicleDetected");
  if (lower === "object:animal") return t("eventTypes.animalDetected");
  if (lower === "object:other") return t("eventTypes.objectDetected");
  if (lower.includes("tamper")) return t("eventTypes.tamperDetected");
  if (lower.includes("motion")) return t("eventTypes.motionDetected");
  if (lower.includes("linedetector")) return t("eventTypes.lineCrossingDetected");
  if (lower.includes("fielddetector") || lower.includes("intrusion")) return t("eventTypes.intrusionDetected");
  if (lower.includes("occupancy")) return t("eventTypes.occupancyDetected");
  return topic;
}

/** Human-friendly translation for a pipeline tag (see backend/src/events/cameraEvents.ts's buildPipelineInfo). */
export function pipelineLabel(pipeline: string, t: (key: string) => string): string {
  switch (pipeline) {
    case "onvif_event":
      return t("events.pipelineOnvifEvent");
    case "video_motion":
      return t("events.pipelineVideoMotion");
    case "object_detection":
      return t("events.pipelineObjectDetection");
    case "face_recognition":
      return t("events.pipelineFaceRecognition");
    case "captioning":
      return t("events.pipelineCaptioning");
    default:
      return pipeline;
  }
}
