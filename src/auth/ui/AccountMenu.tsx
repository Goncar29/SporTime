import { useState } from "react";
import type { AccountSignOut } from "../../account/ui/useSignOut";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { initialsOf } from "../domain/user";
import styles from "./AccountMenu.module.css";
import { useAuth } from "./AuthGate";

interface AccountMenuProps {
  signOut: AccountSignOut;
}

export function AccountMenu({ signOut }: AccountMenuProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [photoFailed, setPhotoFailed] = useState(false);

  return (
    <>
      <section className={styles.account}>
        {user.photoUrl && !photoFailed ? (
          <img
            className={styles.avatar}
            src={user.photoUrl}
            alt={user.name}
            // Google's image host rejects some referrers, and it does not need to know this app.
            referrerPolicy="no-referrer"
            onError={() => {
              setPhotoFailed(true);
            }}
          />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(user.name, user.email)}
          </span>
        )}
        <span className={styles.identity}>
          <span className={styles.name}>{user.name}</span>
          <span className={styles.email}>{user.email}</span>
        </span>
        <button className={styles.signOut} disabled={signOut.signingOut} onClick={signOut.start}>
          {t.signOut}
        </button>
      </section>
      {signOut.signingOut && (
        <p className={styles.status} role="status">
          {t.signingOut}
        </p>
      )}
      {signOut.failed && (
        <p className={styles.error} role="alert">
          {t.signOutFailed}
        </p>
      )}
      {signOut.unsent && (
        <ConfirmDialog
          title={t.unsentChanges}
          message={t.unsentChangesWarning}
          confirmLabel={t.signOutAnyway}
          cancelLabel={t.stay}
          onConfirm={signOut.signOutAnyway}
          onCancel={signOut.stay}
        />
      )}
    </>
  );
}
