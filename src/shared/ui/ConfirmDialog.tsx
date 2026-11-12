import { useEffect, useId, useRef } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  title: string;
  /** Defaults to saying it cannot be undone. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before an irreversible deletion. Focus starts on Cancel, so a stray Enter keeps the data;
 * Tab stays inside, and closing gives focus back to whatever opened the dialog.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      // After a deletion the opener may be gone with its entry; then there is nothing to restore.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    // On the document, so Escape works even if focus has somehow left the dialog.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

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
          if (event.key !== "Tab") return;
          const first = cancelRef.current;
          const last = confirmRef.current;
          const active = document.activeElement;
          if (event.shiftKey && active === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p id={messageId} className={styles.message}>
          {message ?? t.cannotBeUndone}
        </p>
        <div className={styles.actions}>
          <button ref={cancelRef} className={styles.cancel} onClick={onCancel}>
            {cancelLabel ?? t.cancel}
          </button>
          <button ref={confirmRef} className={styles.danger} onClick={onConfirm}>
            {confirmLabel ?? t.confirmDelete}
          </button>
        </div>
      </div>
    </div>
  );
}
