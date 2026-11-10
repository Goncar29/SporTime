import { useI18n } from "../../i18n/ui/I18nProvider";
import styles from "./AccountScreens.module.css";

/** The person responsible for the data. */
const CONTACT_EMAIL = "carlosngonzalez0@gmail.com";

interface PrivacyScreenProps {
  onBack(): void;
}

export function PrivacyScreen({ onBack }: PrivacyScreenProps) {
  const { t } = useI18n();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.privacy}</h1>
        <button className={styles.back} onClick={onBack}>
          {t.back}
        </button>
      </header>
      {t.privacySections.map(({ heading, body }) => (
        <section key={heading} className={styles.section}>
          <h2 className={styles.heading}>{heading}</h2>
          <p className={styles.body}>{body}</p>
        </section>
      ))}
      <section className={styles.section}>
        <h2 className={styles.heading}>{t.privacyContactHeading}</h2>
        <p className={styles.body}>
          {t.privacyContactBody} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </main>
  );
}
