import translations from "./translations.json";
import type { LanguageCode } from "../types/nouba";

export function isRtlLanguage(lang: LanguageCode): boolean {
  return lang === "ar" || lang === "tn-darija";
}

export function t(lang: LanguageCode, key: keyof (typeof translations)["en"]): string {
  const dict = translations[lang] || translations.en;
  return dict[key] || translations.en[key] || key;
}
