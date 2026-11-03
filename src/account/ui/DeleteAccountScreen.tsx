import { useEffect, useState } from "react";
import { AuthFailure, type AuthFailureKind } from "../../auth/domain/user";
import { useI18n } from "../../i18n/ui/I18nProvider";
import styles from "./AccountScreens.module.css";

interface DeleteAccountScreenProps {
  onDelete(): Promise<void>;
  onBack(): void;
}

export function DeleteAccountScreen({ onDelete, onBack }: DeleteAccountScreenProps) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<AuthFailureKind | null>(null);

  // A redirect confirmation never settles, so returning with the back button would restore a stuck page.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setDeleting(false);
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const handleDelete = () => {
    setDeleting(true);
    setFailure(null);
    onDelete()
      .catch((error: unknown) => {
        const kind = error instanceof AuthFailure ? error.kind : "unknown";
        if (kind === "unknown") console.error("Deleting the account failed:", error);
        setFailure(kind === "cancelled" ? null : kind);
      })
      .finally(() => {
        setDeleting(false);
      });
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.deleteAccount}</h1>
      </header>
      <p className={styles.body}>{t.deleteAccountWarning}</p>
      <p className={styles.body}>{t.deleteAccountConfirmNote}</p>
      {failure && (
        <p className={styles.error} role="alert">
          {failure === "network" ? t.deleteAccountErrorNetwork : t.deleteAccountErrorUnknown}
        </p>
      )}
      <div className={styles.actions}>
        <button className={styles.danger} disabled={deleting} onClick={handleDelete}>
          {deleting ? t.deletingAccount : t.confirmDeleteAccount}
        </button>
        <button className={styles.back} disabled={deleting} onClick={onBack}>
          {t.keepAccount}
        </button>
      </div>
    </main>
  );
}
