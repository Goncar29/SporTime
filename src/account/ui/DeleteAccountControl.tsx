import { useEffect, useState } from "react";
import { AuthFailure, type AuthFailureKind } from "../../auth/domain/user";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import styles from "./AccountScreens.module.css";

interface DeleteAccountControlProps {
  onDelete: () => Promise<void>;
  /** True when this page came back from Google re-confirming a deletion the user accepted. */
  confirmedByRedirect: () => Promise<boolean>;
  className?: string;
}

const keepIfDataErased = (current: AuthFailureKind | null) =>
  current === "dataErased" ? current : null;

/**
 * Deleting the account takes one accepted dialog. Firebase may still need Google to confirm an
 * old sign-in; after a redirect for that, the deletion finishes by itself. Success signs the user
 * out, which brings back the sign-in screen.
 */
export function DeleteAccountControl({
  onDelete,
  confirmedByRedirect,
  className,
}: DeleteAccountControlProps) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<AuthFailureKind | null>(null);

  const start = () => {
    setAsking(false);
    setDeleting(true);
    setFailure(keepIfDataErased);
    onDelete()
      .catch((error: unknown) => {
        const kind = error instanceof AuthFailure ? error.kind : "unknown";
        if (kind === "unknown") console.error("Deleting the account failed:", error);
        if (kind === "cancelled") return;
        // A wrong account changes nothing about what already happened, and that message covers it.
        setFailure((current) =>
          current === "dataErased" && kind === "wrongAccount" ? current : kind,
        );
      })
      .finally(() => {
        setDeleting(false);
      });
  };

  // Once per page load. Not cancelled on cleanup: the answer is handed out only once.
  useEffect(() => {
    confirmedByRedirect()
      .then((confirmed) => {
        if (confirmed) start();
      })
      .catch((error: unknown) => {
        console.error("Checking for a pending deletion failed:", error);
      });
  }, []);

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

  return (
    <>
      <button
        className={className}
        disabled={deleting}
        onClick={() => {
          setAsking(true);
        }}
      >
        {t.deleteAccount}
      </button>
      {deleting && (
        <p className={styles.body} role="status">
          {t.deletingAccount}
        </p>
      )}
      {failure && (
        <p className={styles.error} role="alert">
          {failure === "dataErased"
            ? t.deleteAccountErrorUnfinished
            : failure === "network"
              ? t.deleteAccountErrorNetwork
              : failure === "wrongAccount"
                ? t.deleteAccountErrorWrongAccount
                : t.deleteAccountErrorUnknown}
        </p>
      )}
      {asking && (
        <ConfirmDialog
          title={t.deleteAccount}
          message={`${t.deleteAccountWarning} ${t.deleteAccountConfirmNote}`}
          confirmLabel={t.confirmDeleteAccount}
          cancelLabel={t.keepAccount}
          onConfirm={start}
          onCancel={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
