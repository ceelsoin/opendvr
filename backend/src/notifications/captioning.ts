import { getCaptionSettings, isCaptioningEnabledFor } from "./captionSettings.js";
import { getLocalEndpoint } from "../media/llamaCppBridge.js";
import { t } from "../i18n/index.js";
import { logger } from "../lib/logger.js";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Item 4: auto-captions a notable event's snapshot via an OpenAI-compatible
 * `/chat/completions` vision endpoint - either the LOCAL llama.cpp server
 * this backend manages itself (media/llamaCppBridge.ts, provider "local"),
 * or an EXTERNAL one configured by the user (provider "external": a hosted
 * API, or a remote Ollama/LM Studio instance). Never throws: returns `null`
 * on any failure/timeout/misconfiguration, which callers treat as "no
 * caption available" - captioning is always optional.
 */
export async function captionImage(snapshot: Buffer, category: string): Promise<string | null> {
  const settings = getCaptionSettings();
  if (!isCaptioningEnabledFor(category, settings)) {
    return null;
  }

  let endpoint: string;
  let apiKey: string | null = null;
  let model: string;
  if (settings.provider === "local") {
    const localEndpoint = getLocalEndpoint();
    if (!localEndpoint) {
      // Not running yet (still starting up) or failed to start - skip this
      // event's caption rather than block/retry; the next event will pick
      // it up once the process is actually ready.
      return null;
    }
    endpoint = localEndpoint;
    // llama-server only ever has one model loaded, so the exact string here
    // doesn't matter to it - any non-empty value works.
    model = "local";
  } else {
    endpoint = settings.endpoint!;
    apiKey = settings.apiKey;
    model = settings.model!;
  }

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
