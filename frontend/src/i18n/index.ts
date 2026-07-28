import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ptBR from "./locales/pt-BR.json";
import en from "./locales/en.json";

export const SUPPORTED_LANGUAGES = ["pt-BR", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "opendvr.language";

function detectInitialLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
    return stored as SupportedLanguage;
  }
  // Default to Portuguese (this app's primary audience) unless the browser
  // is clearly set to something else we support.
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "pt-BR";
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      "pt-BR": { translation: ptBR },
      en: { translation: en },
    },
    lng: detectInitialLanguage(),
    fallbackLng: "pt-BR",
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
});

export default i18n;
