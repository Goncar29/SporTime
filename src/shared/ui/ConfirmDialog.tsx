import { useEffect, useId, useRef } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  title: string;
  onConfirm(): void;
  onCancel(): void;
}

/** Asks before an irreversible deletion. Focus starts on Cancel, so a stray Enter keeps the data. */
export function ConfirmDialog({ title, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p id={messageId} className={styles.message}>
          {t.cannotBeUndone}
        </p>
        <div className={styles.actions}>
          <button ref={cancelRef} className={styles.cancel} onClick={onCancel}>
            {t.cancel}
          </button>
          <button className={styles.danger} onClick={onConfirm}>
            {t.confirmDelete}
          </button>
        </div>
      </div>
    </div>
  );
}
