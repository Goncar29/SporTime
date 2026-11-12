import type { ReactNode } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { LanguageSwitcher } from "../../i18n/ui/LanguageSwitcher";
import { InstallOption } from "../../install/ui/InstallBanner";
import styles from "./AccountScreens.module.css";
import { DeleteAccountControl } from "./DeleteAccountControl";
import profile from "./ProfileScreen.module.css";
import type { AccountDeletion } from "./useAccountDeletion";

interface ProfileScreenProps {
  /** Who is signed in, with the sign-out button. */
  account?: ReactNode;
  deletion: AccountDeletion;
  onOpenSettings: () => void;
  onOpenPrivacy: () => void;
}

/** Everything about the user and the app itself, kept off the timer so it stays uncluttered. */
export function ProfileScreen({
  account,
  deletion,
  onOpenSettings,
  onOpenPrivacy,
}: ProfileScreenProps) {
  const { t } = useI18n();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.profile}</h1>
      </header>

      {account}

      <div className={profile.row}>
        <span className={profile.rowLabel}>{t.language}</span>
        <LanguageSwitcher />
      </div>

      <div className={profile.menu}>
        <button className={profile.item} onClick={onOpenSettings}>
          {t.settings}
          <Chevron />
        </button>
        <button className={profile.item} onClick={onOpenPrivacy}>
          {t.privacy}
          <Chevron />
        </button>
        <InstallOption className={profile.item} />
      </div>

      <div className={profile.danger}>
        <DeleteAccountControl className={profile.deleteAccount} deletion={deletion} />
      </div>
    </main>
  );
}

function Chevron() {
  return (
    <svg
      className={profile.chevron}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
