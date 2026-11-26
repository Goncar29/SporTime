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
  /** Without it, the Routines section is not offered. */
  onOpenRoutines?: () => void;
  /** How many received routines are new (T27); none is shown while unknown (null) or zero. */
  newRoutineCount?: number | null;
  /** Without it, the Contacts section is not offered. */
  onOpenContacts?: () => void;
  /** How many contacts there are; null while unknown, so none is shown. */
  contactCount?: number | null;
  /** The switch to be found by email; without it, none is offered. */
  findByEmail?: ReactNode;
}

/** Everything about the user and the app itself, kept off the timer so it stays uncluttered. */
export function ProfileScreen({
  account,
  deletion,
  onOpenSettings,
  onOpenPrivacy,
  onOpenRoutines,
  newRoutineCount = null,
  onOpenContacts,
  contactCount = null,
  findByEmail,
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

      {findByEmail}

      <div className={profile.menu}>
        {onOpenRoutines && (
          <button
            className={profile.item}
            onClick={onOpenRoutines}
            aria-label={newRoutineCount ? t.routinesMenuLabel(newRoutineCount) : undefined}
          >
            {newRoutineCount ? t.routinesMenuItem(newRoutineCount) : t.routines}
            <Chevron />
          </button>
        )}
        {onOpenContacts && (
          <button
            className={profile.item}
            onClick={onOpenContacts}
            aria-label={contactCount === null ? undefined : t.contactsMenuLabel(contactCount)}
          >
            {contactCount === null ? t.contacts : t.contactsMenuItem(contactCount)}
            <Chevron />
          </button>
        )}
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
