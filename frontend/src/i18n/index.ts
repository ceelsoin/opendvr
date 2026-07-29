import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { apiClient } from "../api/client";
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

// Portuguese and English first (this app's primary audience), followed by
// the languages with the largest populations that predominantly don't
// speak English (per EF EPI-style rankings: Spanish/French/German-speaking
// Europe, China, Japan, Korea, Russia, the Arab world, India, Indonesia).
export const SUPPORTED_LANGUAGES = [
  "pt-BR",
  "en",
  "es",
  "fr",
  "de",
  "zh-CN",
  "ja",
  "ko",
  "ru",
  "ar",
  "hi",
  "id",
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Each language's own native name/script (standard UX convention - a
// visitor should recognize their language even if the current UI language
// is one they don't read). Shared by LanguageSwitcher (sidebar) and
// SetupPage (initial account creation, before there's a sidebar).
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  "pt-BR": "Português (BR)",
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "zh-CN": "中文（简体）",
  ja: "日本語",
  ko: "한국어",
  ru: "Русский",
  ar: "العربية",
  hi: "हिन्दी",
  id: "Bahasa Indonesia",
};

/** Languages that read right-to-left - used to set `<html dir>` so at least text alignment/reading order is correct (full RTL-mirrored layout is a larger, separate effort not attempted here). */
export const RTL_LANGUAGES: readonly SupportedLanguage[] = ["ar"];

const STORAGE_KEY = "opendvr.language";

/** Maps a browser locale (e.g. "zh-Hans-CN", "pt-PT", "es-MX") to one of our supported language codes, matching on the primary language subtag first. */
function matchSupportedLanguage(locale: string): SupportedLanguage | null {
  const primary = locale.toLowerCase().split("-")[0];
  if (primary === "pt") return "pt-BR";
  if (primary === "zh") return "zh-CN";
  const direct = SUPPORTED_LANGUAGES.find((lng) => lng.toLowerCase() === primary || lng.toLowerCase().startsWith(`${primary}-`));
  return direct ?? null;
}

function detectInitialLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
    return stored as SupportedLanguage;
  }
  // Default to Portuguese (this app's primary audience) unless the browser
  // is clearly set to one of the languages we support.
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const match = matchSupportedLanguage(candidate);
    if (match) return match;
  }
  return "pt-BR";
}

function applyTextDirection(lng: string) {
  document.documentElement.dir = (RTL_LANGUAGES as readonly string[]).includes(lng) ? "rtl" : "ltr";
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      "pt-BR": { translation: ptBR },
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      "zh-CN": { translation: zhCN },
      ja: { translation: ja },
      ko: { translation: ko },
      ru: { translation: ru },
      ar: { translation: ar },
      hi: { translation: hi },
      id: { translation: id },
    },
    lng: detectInitialLanguage(),
    fallbackLng: "pt-BR",
    interpolation: { escapeValue: false },
  });

applyTextDirection(i18n.language);

// Keeps the backend's notification language (Discord/Telegram/email/webhook
// text, see backend/src/notifications/webhooks.ts) in sync with whatever
// language the user actually reads the UI in. Skipped on /login and /setup
// since there's no authenticated session yet at that point - the request
// would just 401 and (per apiClient's interceptor) bounce the page to
// /login for no reason. The setup page itself only affects local i18next
// state until an account is created; the backend keeps its own default
// (pt-BR) until the first authenticated sync happens after login.
i18n.on("languageChanged", (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
  applyTextDirection(lng);

  const path = window.location.pathname;
  if (path.endsWith("/login") || path.endsWith("/setup")) return;
  void apiClient.put("/settings/language", { language: lng }).catch(() => {
    // Non-fatal: the backend just keeps using its previously stored
    // language for notifications until the next successful sync.
  });
});

export default i18n;

