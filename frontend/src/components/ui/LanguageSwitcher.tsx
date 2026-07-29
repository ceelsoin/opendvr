import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../../i18n";

// Each language's own native name/script (standard UX convention - a
// visitor should recognize their language even if the current UI language
// is one they don't read).
const LANGUAGE_LABELS: Record<string, string> = {
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

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-500">
      {t("language.label")}
      <select
        value={i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {LANGUAGE_LABELS[lng]}
          </option>
        ))}
      </select>
    </label>
  );
}
