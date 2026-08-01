import { getCaptionSettings, isCaptioningEnabledFor, type CaptioningProvider } from "./captionSettings.js";
import { env } from "../config/env.js";
import { getBackendLanguage, t, type BackendLanguage } from "../i18n/index.js";
import { logger } from "../lib/logger.js";
import type { ClassifiedMotion } from "../media/objectDetection.js";

const REQUEST_TIMEOUT_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

/** English name of each supported language, for the "respond only in ___" instruction below - written in English regardless of target language, since small/instruction-light VLMs follow an English meta-instruction more reliably than one phrased in the target language itself. */
const LANGUAGE_NAMES: Record<BackendLanguage, string> = {
  "pt-BR": "Portuguese (Brazil)",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  "zh-CN": "Simplified Chinese",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  id: "Indonesian",
};

/** Same shape media/objectDetection.ts's classifyMotionFrame produces - only ever available for "object:*" events (see events/cameraEvents.ts's call site). */
type DetectionContext = ClassifiedMotion["metadata"];

/**
 * Summarizes what the object-detection/face-recognition pipeline already
 * found, so the VLM has a head start instead of guessing from pixels alone
 * (e.g. "I think there's a person and a car" instead of relying purely on
 * the image). Deliberately phrased as a HINT, not a fact the model must
 * repeat verbatim - a stale/wrong prior detection (e.g. a face match with
 * middling confidence) shouldn't be stated as certain in the caption.
 */
function buildDetectionContextHint(detections: DetectionContext | null | undefined): string | null {
  if (!detections) return null;
  const parts: string[] = [];

  if (detections.objects?.length) {
    const objectsText = detections.objects
      .slice(0, 5)
      .map((o) => `${o.label} (${Math.round(o.confidence * 100)}% confidence)`)
      .join(", ");
    parts.push(`an object-detection pass already found: ${objectsText}`);
  }
  if (detections.faces?.length) {
    const facesText = detections.faces
      .map((f) => (f.name ? `${f.name} (${Math.round(f.confidence * 100)}% confidence)` : "an unrecognized face"))
      .join(", ");
    parts.push(`face recognition matched: ${facesText}`);
  }
  if (parts.length === 0) return null;

  return `For context, ${parts.join("; ")}. Use this only as a hint - describe what you actually see in the image, and don't just repeat these labels verbatim if the image doesn't clearly support them.`;
}

/** Base `/v1`-style endpoint actually used for a given provider - "cpu"/"gpu" are pre-wired, "external" is whatever the user configured. */
function resolveEndpoint(settings: ReturnType<typeof getCaptionSettings>): string | null {
  if (settings.provider === "external") return settings.endpoint;
  return settings.provider === "gpu" ? env.captioningGpuEndpoint : env.captioningCpuEndpoint;
}

/**
 * Item 4: auto-captions a notable event's snapshot via an OpenAI-compatible
 * `/chat/completions` vision endpoint - either one configured by the user
 * (provider "external": a hosted API, or a remote Ollama/LM Studio
 * instance), or the optional `llamacpp-cpu`/`llamacpp-gpu` docker-compose
 * sidecar services (providers "cpu"/"gpu" - official prebuilt
 * ggml-org/llama.cpp images, pre-wired to fixed endpoints, see
 * config/env.ts). Never throws: returns `null` on any failure/timeout/
 * misconfiguration (including the sidecar container not being started),
 * which callers treat as "no caption available" - captioning is always
 * optional. `detections` (when available, see events/cameraEvents.ts's call
 * site) feeds the prior object-detection/face-recognition results into the
 * prompt as context, and the caption is explicitly instructed to answer in
 * the app's configured language (see getBackendLanguage()/LANGUAGE_NAMES) -
 * small VLMs otherwise tend to default to English regardless of the
 * prompt's own language. `baselineSnapshot` (see media/baselineSnapshot.ts),
 * when available, is sent as a SECOND reference image (the camera's normal,
 * idle view) alongside the event frame, with the model instructed to
 * describe only what changed between the two - turns "there's a car" into
 * "a car that wasn't there before is now parked in the driveway".
 */
export async function captionImage(
  snapshot: Buffer,
  category: string,
  detections?: DetectionContext | null,
  baselineSnapshot?: Buffer | null
): Promise<string | null> {
  const settings = getCaptionSettings();
  if (!isCaptioningEnabledFor(category, settings)) {
    return null;
  }

  const endpoint = resolveEndpoint(settings)!;
  const apiKey = settings.provider === "external" ? settings.apiKey : null;
  // llama-server only ever has one model loaded, so the exact string here
  // doesn't matter to it - any non-empty value works.
  const model = settings.provider === "external" ? settings.model! : "local";

  const language = getBackendLanguage();
  const promptParts = [
    t("captioning.prompt"),
    baselineSnapshot
      ? "The first image is this camera's normal, empty view for reference; the second image is the moment the event was detected. Compare them and describe only what actually changed or newly appeared in the second image - ignore anything present in both."
      : null,
    buildDetectionContextHint(detections),
    `Respond only in ${LANGUAGE_NAMES[language]}.`,
  ];
  const promptText = promptParts.filter((part): part is string => Boolean(part)).join(" ");

  const toDataUri = (buffer: Buffer) => `data:image/jpeg;base64,${buffer.toString("base64")}`;
  const imageContent = [
    ...(baselineSnapshot ? [{ type: "image_url", image_url: { url: toDataUri(baselineSnapshot) } }] : []),
    { type: "image_url", image_url: { url: toDataUri(snapshot) } },
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: promptText }, ...imageContent],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn({ status: response.status, provider: settings.provider }, "Captioning endpoint returned an error response");
      return null;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const caption = data.choices?.[0]?.message?.content?.trim();
    return caption || null;
  } catch (err) {
    logger.warn({ err, provider: settings.provider }, "Failed to fetch caption from the configured VLM endpoint");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface CaptioningHealth {
  provider: CaptioningProvider;
  enabled: boolean;
  /** Whether the provider has everything it needs (endpoint+model for "external"; "cpu"/"gpu" are always considered configured, see captionSettings.ts). */
  configured: boolean;
  /** null when not enabled/configured - there's nothing meaningful to reach. */
  reachable: boolean | null;
  latencyMs: number | null;
}

/**
 * Reachability/latency check for the Dashboard's process-health view -
 * "cpu"/"gpu" hit the sidecar's llama.cpp `/health` endpoint (root-level,
 * not under `/v1`); "external" just probes the configured base endpoint
 * itself, since an arbitrary third-party API has no guaranteed `/health`
 * route. Never throws.
 */
export async function getCaptioningHealth(): Promise<CaptioningHealth> {
  const settings = getCaptionSettings();
  const configured = settings.provider === "external" ? Boolean(settings.endpoint && settings.model) : true;
  if (!settings.enabled || !configured) {
    return { provider: settings.provider, enabled: settings.enabled, configured, reachable: null, latencyMs: null };
  }

  const endpoint = resolveEndpoint(settings)!;
  const healthUrl =
    settings.provider === "external" ? endpoint.replace(/\/$/, "") : `${endpoint.replace(/\/v1\/?$/, "")}/health`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  const start = Date.now();
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    // Any response at all (even a 404 for providers with no /health route)
    // means the endpoint is at least reachable - only network-level
    // failures (connection refused, timeout) mean "down".
    return { provider: settings.provider, enabled: true, configured, reachable: response.status < 500, latencyMs: Date.now() - start };
  } catch {
    return { provider: settings.provider, enabled: true, configured, reachable: false, latencyMs: null };
  } finally {
    clearTimeout(timeout);
  }
}
