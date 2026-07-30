import { getSetting, setSetting } from "../db/settings.repository.js";
import { env } from "../config/env.js";

/**
 * Settings for item 4 (VLM auto-captioning): which categories (from item 1's
 * object-detection classification) get a caption generated, and where the
 * caption comes from - either an external OpenAI-compatible endpoint
 * (hosted API, or a remote Ollama/LM Studio instance) or a LOCAL llama.cpp
 * server process managed by this backend itself (see media/llamaCppBridge.ts),
 * running SmolVLM or any other GGUF vision model. Every field here,
 * including CPU/GPU acceleration for the local process, is editable at
 * runtime from the Settings page - same convention as notificationSettings.ts.
 */
const KEYS = {
  enabled: "captioning.enabled",
  provider: "captioning.provider",
  endpoint: "captioning.endpoint",
  apiKey: "captioning.apiKey",
  model: "captioning.model",
  categoryPerson: "captioning.categoryPerson",
  categoryVehicle: "captioning.categoryVehicle",
  categoryAnimal: "captioning.categoryAnimal",
  categoryOther: "captioning.categoryOther",
  localModelPath: "captioning.localModelPath",
  localMmprojPath: "captioning.localMmprojPath",
  localAcceleration: "captioning.localAcceleration",
  localThreads: "captioning.localThreads",
  localGpuLayers: "captioning.localGpuLayers",
  localContextSize: "captioning.localContextSize",
  localPort: "captioning.localPort",
} as const;

export type CaptioningProvider = "external" | "local";
export type CaptioningAcceleration = "cpu" | "gpu";

function getBool(key: string, fallback: boolean): boolean {
  const value = getSetting(key);
  if (value === null) return fallback;
  return value === "1";
}

function getNumber(key: string, fallback: number): number {
  const value = getSetting(key);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface CaptionSettings {
  enabled: boolean;
  provider: CaptioningProvider;
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
  categoryPerson: boolean;
  categoryVehicle: boolean;
  categoryAnimal: boolean;
  categoryOther: boolean;
  /** Path (inside the container) to a .gguf language model - used only when provider === "local". */
  localModelPath: string | null;
  /** Path (inside the container) to the matching .gguf multimodal projector - used only when provider === "local". */
  localMmprojPath: string | null;
  localAcceleration: CaptioningAcceleration;
  /** CPU threads for llama.cpp - only meaningful when localAcceleration === "cpu". */
  localThreads: number;
  /** Layers offloaded to GPU (llama.cpp's --n-gpu-layers) - only meaningful when localAcceleration === "gpu", and only takes effect if the running llama-server binary was actually built with GPU support (see docs/configuration.md). */
  localGpuLayers: number;
  localContextSize: number;
  /** Loopback-only port for the local llama-server process - never exposed outside the container. */
  localPort: number;
}

export function getCaptionSettings(): CaptionSettings {
  return {
    enabled: getBool(KEYS.enabled, false),
    provider: (getSetting(KEYS.provider) as CaptioningProvider | null) ?? env.captioningProvider,
    endpoint: getSetting(KEYS.endpoint) ?? env.captioningEndpoint,
    apiKey: getSetting(KEYS.apiKey) ?? env.captioningApiKey,
    model: getSetting(KEYS.model) ?? env.captioningModel,
    // Default on for person/vehicle (the categories users most want
    // described), off for animal/other (lower signal, more noise) - all
    // four are independently toggleable from the Settings page.
    categoryPerson: getBool(KEYS.categoryPerson, true),
    categoryVehicle: getBool(KEYS.categoryVehicle, true),
    categoryAnimal: getBool(KEYS.categoryAnimal, false),
    categoryOther: getBool(KEYS.categoryOther, false),
    localModelPath: getSetting(KEYS.localModelPath) ?? env.captioningLocalModelPath,
    localMmprojPath: getSetting(KEYS.localMmprojPath) ?? env.captioningLocalMmprojPath,
    localAcceleration: (getSetting(KEYS.localAcceleration) as CaptioningAcceleration | null) ?? env.captioningLocalAcceleration,
    localThreads: getNumber(KEYS.localThreads, env.captioningLocalThreads),
    localGpuLayers: getNumber(KEYS.localGpuLayers, env.captioningLocalGpuLayers),
    localContextSize: getNumber(KEYS.localContextSize, env.captioningLocalContextSize),
    localPort: getNumber(KEYS.localPort, env.captioningLocalPort),
  };
}

export interface UpdateCaptionSettingsInput {
  enabled?: boolean;
  provider?: CaptioningProvider;
  endpoint?: string | null;
  apiKey?: string | null;
  model?: string | null;
  categoryPerson?: boolean;
  categoryVehicle?: boolean;
  categoryAnimal?: boolean;
  categoryOther?: boolean;
  localModelPath?: string | null;
  localMmprojPath?: string | null;
  localAcceleration?: CaptioningAcceleration;
  localThreads?: number;
  localGpuLayers?: number;
  localContextSize?: number;
  localPort?: number;
}

function setStringSetting(key: string, value: string | null | undefined): void {
  if (value === undefined) return;
  setSetting(key, value || null);
}

function setBoolSetting(key: string, value: boolean | undefined): void {
  if (value === undefined) return;
  setSetting(key, value ? "1" : "0");
}

function setNumberSetting(key: string, value: number | undefined): void {
  if (value === undefined) return;
  setSetting(key, String(value));
}

export function updateCaptionSettings(input: UpdateCaptionSettingsInput): CaptionSettings {
  setBoolSetting(KEYS.enabled, input.enabled);
  setStringSetting(KEYS.provider, input.provider);
  setStringSetting(KEYS.endpoint, input.endpoint);
  setStringSetting(KEYS.apiKey, input.apiKey);
  setStringSetting(KEYS.model, input.model);
  setBoolSetting(KEYS.categoryPerson, input.categoryPerson);
  setBoolSetting(KEYS.categoryVehicle, input.categoryVehicle);
  setBoolSetting(KEYS.categoryAnimal, input.categoryAnimal);
  setBoolSetting(KEYS.categoryOther, input.categoryOther);
  setStringSetting(KEYS.localModelPath, input.localModelPath);
  setStringSetting(KEYS.localMmprojPath, input.localMmprojPath);
  setStringSetting(KEYS.localAcceleration, input.localAcceleration);
  setNumberSetting(KEYS.localThreads, input.localThreads);
  setNumberSetting(KEYS.localGpuLayers, input.localGpuLayers);
  setNumberSetting(KEYS.localContextSize, input.localContextSize);
  setNumberSetting(KEYS.localPort, input.localPort);
  return getCaptionSettings();
}

/** Whether captioning should run at all for a given object-detection category (e.g. "person"). */
export function isCaptioningEnabledFor(category: string, settings: CaptionSettings): boolean {
  if (!settings.enabled) return false;
  const configured =
    settings.provider === "local"
      ? Boolean(settings.localModelPath && settings.localMmprojPath)
      : Boolean(settings.endpoint && settings.model);
  if (!configured) return false;
  switch (category) {
    case "person":
      return settings.categoryPerson;
    case "vehicle":
      return settings.categoryVehicle;
    case "animal":
      return settings.categoryAnimal;
    default:
      return settings.categoryOther;
  }
}
