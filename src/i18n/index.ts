import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ptBR from "./pt-BR.json";
import en from "./en.json";
import es from "./es.json";

function resolveInitialLang(): string {
  const saved = localStorage.getItem("tagwave_language");
  const explicit = localStorage.getItem("tagwave_language_explicit");
  // Só respeita valor salvo se foi escolha explícita do usuário via Settings
  if (saved && explicit) return saved;
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("pt")) return "pt-BR";
  if (nav.startsWith("es")) return "es";
  // Inglês nunca por auto-detecção — sempre requer escolha explícita
  return "pt-BR";
}

i18n
  .use(initReactI18next)
  .init({
    lng: resolveInitialLang(),
    resources: {
      "pt-BR": { translation: ptBR },
      pt:      { translation: ptBR },
      en:      { translation: en },
      "en-US": { translation: en },
      "en-GB": { translation: en },
      es:      { translation: es },
      "es-419": { translation: es },
    },
    fallbackLng: "pt-BR",
    interpolation: { escapeValue: false },
  });

export function changeLanguage(lang: string) {
  localStorage.setItem("tagwave_language", lang);
  localStorage.setItem("tagwave_language_explicit", "1");
  i18n.changeLanguage(lang);
}

export default i18n;
