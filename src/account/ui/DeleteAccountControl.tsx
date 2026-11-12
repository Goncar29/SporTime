import { useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import styles from "./AccountScreens.module.css";
import type { AccountDeletion } from "./useAccountDeletion";

interface DeleteAccountControlProps {
  deletion: AccountDeletion;
  className?: string;
}

/**
 * Deleting the account takes one accepted dialog. Firebase may still need Google to confirm an
 * old sign-in; after a redirect for that, the deletion finishes by itself. Success signs the user
 * out, which brings back the sign-in screen.
 */
export function DeleteAccountControl({ deletion, className }: DeleteAccountControlProps) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const { deleting, failure } = deletion;

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
          onConfirm={() => {
            setAsking(false);
            deletion.start();
          }}
          onCancel={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
