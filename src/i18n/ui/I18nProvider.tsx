import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LanguageStore } from "../application/ports";
import { resolveLanguage, type Language } from "../domain/language";
import { MESSAGES } from "../messages";
import type { Messages } from "../messages/types";

interface I18n {
  language: Language;
  t: Messages;
  setLanguage(language: Language): void;
}

const I18nContext = createContext<I18n | null>(null);

interface I18nProviderProps {
  store: LanguageStore;
  browserLanguages: readonly string[];
  children: ReactNode;
}

export function I18nProvider({ store, browserLanguages, children }: I18nProviderProps) {
  const [language, setLanguageState] = useState(() =>
    resolveLanguage(store.get(), browserLanguages),
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18n>(
    () => ({
      language,
      t: MESSAGES[language],
      setLanguage(next) {
        store.set(next);
        setLanguageState(next);
      },
    }),
    [language, store],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error("useI18n must be used inside I18nProvider");
  return i18n;
}
