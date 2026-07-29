import ptBR from "./locales/pt-BR.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import zhCN from "./locales/zh-CN.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import ru from "./locales/ru.json";
import ar from "./locales/ar.json";
import hi from "./locales/hi.json";
import id from "./locales/id.json";
import { getSetting, setSetting } from "../db/settings.repository.js";

// Mirrors frontend/src/i18n's SUPPORTED_LANGUAGES - kept as a separate,
// self-contained resource set (backend/frontend don't share a package),
// scoped to just the strings the backend itself needs to emit: API error
// messages and outbound notification text (Discord/Telegram/email/webhook,
// see notifications/webhooks.ts). Everything else (the UI) is translated
// entirely on the frontend.
const RESOURCES = {
  "pt-BR": ptBR,
  en,
  es,
  fr,
  de,
  "zh-CN": zhCN,
  ja,
  ko,
  ru,
  ar,
  hi,
  id,
} as const;

export type BackendLanguage = keyof typeof RESOURCES;
export const SUPPORTED_BACKEND_LANGUAGES = Object.keys(RESOURCES) as BackendLanguage[];
const DEFAULT_LANGUAGE: BackendLanguage = "pt-BR";
const LANGUAGE_SETTING_KEY = "app.language";

function isSupportedLanguage(value: string | null): value is BackendLanguage {
  return value !== null && (SUPPORTED_BACKEND_LANGUAGES as string[]).includes(value);
}

/**
 * The single admin's UI language (this app has exactly one admin account,
 * no per-user preferences - see docs/features.md's Authentication
 * section), kept in sync with the frontend's language switcher (see
 * frontend/src/i18n/index.ts's `languageChanged` listener, which PATCHes
 * `/api/settings/language`). Used to translate API error messages and
 * outbound notifications server-side, so they match whatever language the
 * user actually reads the UI in - the same app should not speak Portuguese
 * in the interface but English in Discord/e-mail notifications.
 */
export function getBackendLanguage(): BackendLanguage {
  const stored = getSetting(LANGUAGE_SETTING_KEY);
  return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE;
}

export function setBackendLanguage(language: string): void {
  if (!isSupportedLanguage(language)) {
    throw new Error(`Unsupported language: ${language}`);
  }
  setSetting(LANGUAGE_SETTING_KEY, language);
}

function resolveKey(resource: Record<string, unknown>, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[part];
    return undefined;
  }, resource);
  return typeof value === "string" ? value : undefined;
}

/**
 * Simple key-lookup translator with `{{var}}` interpolation - no need for
 * the full i18next library on the backend for this small, fixed set of
 * strings. Falls back to the default language, then to the raw key itself,
 * so a missing translation never crashes a request/notification.
 */
export function t(key: string, vars?: Record<string, string | number>, language: BackendLanguage = getBackendLanguage()): string {
  const resource = RESOURCES[language] ?? RESOURCES[DEFAULT_LANGUAGE];
  const template = resolveKey(resource, key) ?? resolveKey(RESOURCES[DEFAULT_LANGUAGE], key) ?? key;
  if (!vars) return template;
  return Object.entries(vars).reduce((acc, [name, value]) => acc.replaceAll(`{{${name}}}`, String(value)), template);
}
