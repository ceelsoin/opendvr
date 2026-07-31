import { getCaptionSettings, isCaptioningEnabledFor, type CaptioningProvider } from "./captionSettings.js";
import { env } from "../config/env.js";
import { t } from "../i18n/index.js";
import { logger } from "../lib/logger.js";

const REQUEST_TIMEOUT_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

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
 * optional.
 */
export async function captionImage(snapshot: Buffer, category: string): Promise<string | null> {
  const settings = getCaptionSettings();
  if (!isCaptioningEnabledFor(category, settings)) {
    return null;
  }

  const endpoint = resolveEndpoint(settings)!;
  const apiKey = settings.provider === "external" ? settings.apiKey : null;
  // llama-server only ever has one model loaded, so the exact string here
  // doesn't matter to it - any non-empty value works.
  const model = settings.provider === "external" ? settings.model! : "local";


  const dataUri = `data:image/jpeg;base64,${snapshot.toString("base64")}`;
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
            content: [
              { type: "text", text: t("captioning.prompt") },
              { type: "image_url", image_url: { url: dataUri } },
            ],
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
