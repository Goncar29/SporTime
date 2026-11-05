import accountStyles from "../../account/ui/AccountScreens.module.css";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { SOUND_SETTINGS_KEYS, type SoundSettings } from "../../timer/domain/soundSettings";
import styles from "./SettingsScreen.module.css";

const NEEDS_VOICE: ReadonlySet<keyof SoundSettings> = new Set([
  "tenSecondsLeft",
  "halfway",
  "intervalName",
]);

interface SettingsScreenProps {
  sound: SoundSettings;
  voiceAvailable: boolean;
  onChangeSound(next: SoundSettings): void;
  onBack(): void;
}

export function SettingsScreen({
  sound,
  voiceAvailable,
  onChangeSound,
  onBack,
}: SettingsScreenProps) {
  const { t } = useI18n();
  return (
    <main className={accountStyles.page}>
      <header className={accountStyles.header}>
        <h1 className={accountStyles.title}>{t.settings}</h1>
        <button className={accountStyles.back} onClick={onBack}>
          {t.back}
        </button>
      </header>
      <section className={accountStyles.section}>
        <h2 className={accountStyles.heading}>{t.soundSettings}</h2>
        {SOUND_SETTINGS_KEYS.map((key) => (
          <label key={key} className={styles.option}>
            {t.soundOptions[key]}
            <input
              className={styles.switch}
              type="checkbox"
              role="switch"
              checked={sound[key]}
              disabled={NEEDS_VOICE.has(key) && !sound.voice}
              onChange={(event) => {
                onChangeSound({ ...sound, [key]: event.target.checked });
              }}
            />
          </label>
        ))}
        <p className={styles.note}>{t.voiceNote}</p>
        {sound.voice && !voiceAvailable && (
          <p className={accountStyles.error} role="status">
            {t.voiceUnavailable}
          </p>
        )}
      </section>
    </main>
  );
}
