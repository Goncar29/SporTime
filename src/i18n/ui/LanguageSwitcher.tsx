import { LANGUAGES, type Language } from "../domain/language";
import { useI18n } from "./I18nProvider";
import styles from "./LanguageSwitcher.module.css";

/** Each language is named in itself so it can be found without reading the current one. */
const NATIVE_NAMES: Record<Language, string> = { en: "English", es: "Español" };

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className={styles.switcher} role="group" aria-label={t.language}>
      {LANGUAGES.map((option) => (
        <button
          key={option}
          className={styles.option}
          lang={option}
          aria-label={NATIVE_NAMES[option]}
          aria-pressed={option === language}
          onClick={() => {
            setLanguage(option);
          }}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
