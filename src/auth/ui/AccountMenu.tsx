import { useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { initialsOf } from "../domain/user";
import styles from "./AccountMenu.module.css";
import { useAuth } from "./AuthGate";

export function AccountMenu() {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const [photoFailed, setPhotoFailed] = useState(false);

  return (
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
      <button className={styles.signOut} onClick={signOut}>
        {t.signOut}
      </button>
    </section>
  );
}
