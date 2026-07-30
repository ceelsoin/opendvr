import { getCaptionSettings, isCaptioningEnabledFor } from "./captionSettings.js";
import { t } from "../i18n/index.js";
import { logger } from "../lib/logger.js";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Item 4: auto-captions a notable event's snapshot via any OpenAI-compatible
 * `/chat/completions` vision endpoint (a local Ollama/LM Studio instance
 * running a small VLM, or a hosted API) - deliberately NOT running any VLM
 * in-process, since even a small one is too heavy for the dual/quad-core,
 * no-GPU hardware this project targets (see docs/configuration.md). Never
 * throws: returns `null` on any failure/timeout/misconfiguration, which
 * callers treat as "no caption available" - captioning is always optional.
 */
export async function captionImage(snapshot: Buffer, category: string): Promise<string | null> {
  const settings = getCaptionSettings();
  if (!isCaptioningEnabledFor(category, settings)) {
    return null;
  }

  const dataUri = `data:image/jpeg;base64,${snapshot.toString("base64")}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${settings.endpoint!.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
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
      logger.warn({ status: response.status }, "Captioning endpoint returned an error response");
      return null;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const caption = data.choices?.[0]?.message?.content?.trim();
    return caption || null;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch caption from the configured VLM endpoint");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
