import { getSetting, setSetting } from "../db/settings.repository.js";
import { env } from "../config/env.js";

/**
 * Settings for item 4 (VLM auto-captioning): which categories (from item 1's
 * object-detection classification) get a caption generated, and which
 * OpenAI-compatible vision endpoint to call. Same runtime-editable-via-
 * Settings-page + env-var-fallback convention as notificationSettings.ts.
 */
const KEYS = {
  enabled: "captioning.enabled",
  endpoint: "captioning.endpoint",
  apiKey: "captioning.apiKey",
  model: "captioning.model",
  categoryPerson: "captioning.categoryPerson",
  categoryVehicle: "captioning.categoryVehicle",
  categoryAnimal: "captioning.categoryAnimal",
  categoryOther: "captioning.categoryOther",
} as const;

function getBool(key: string, fallback: boolean): boolean {
  const value = getSetting(key);
  if (value === null) return fallback;
  return value === "1";
}

export interface CaptionSettings {
  enabled: boolean;
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
  categoryPerson: boolean;
  categoryVehicle: boolean;
  categoryAnimal: boolean;
  categoryOther: boolean;
}

export function getCaptionSettings(): CaptionSettings {
  return {
    enabled: getBool(KEYS.enabled, false),
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
  };
}

export interface UpdateCaptionSettingsInput {
  enabled?: boolean;
  endpoint?: string | null;
  apiKey?: string | null;
  model?: string | null;
  categoryPerson?: boolean;
  categoryVehicle?: boolean;
  categoryAnimal?: boolean;
  categoryOther?: boolean;
}

function setStringSetting(key: string, value: string | null | undefined): void {
  if (value === undefined) return;
  setSetting(key, value || null);
}

function setBoolSetting(key: string, value: boolean | undefined): void {
  if (value === undefined) return;
  setSetting(key, value ? "1" : "0");
}

export function updateCaptionSettings(input: UpdateCaptionSettingsInput): CaptionSettings {
  setBoolSetting(KEYS.enabled, input.enabled);
  setStringSetting(KEYS.endpoint, input.endpoint);
  setStringSetting(KEYS.apiKey, input.apiKey);
  setStringSetting(KEYS.model, input.model);
  setBoolSetting(KEYS.categoryPerson, input.categoryPerson);
  setBoolSetting(KEYS.categoryVehicle, input.categoryVehicle);
  setBoolSetting(KEYS.categoryAnimal, input.categoryAnimal);
  setBoolSetting(KEYS.categoryOther, input.categoryOther);
  return getCaptionSettings();
}

/** Whether captioning should run at all for a given object-detection category (e.g. "person"). */
export function isCaptioningEnabledFor(category: string, settings: CaptionSettings): boolean {
  if (!settings.enabled || !settings.endpoint || !settings.model) return false;
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
