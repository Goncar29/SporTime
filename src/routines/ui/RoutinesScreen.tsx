import { useId, useState } from "react";
import { isolate } from "../../i18n/messages/isolate";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import type { Routine } from "../domain/routine";
import { ReceivedFrom } from "./ReceivedFrom";
import styles from "./RoutinesScreen.module.css";

interface RoutinesScreenProps {
  /** Newest first; null until the first answer arrives. */
  routines: readonly Routine[] | null;
  errors: readonly string[];
  onBack: () => void;
  onNew: () => void;
  onOpen: (routine: Routine) => void;
  onEdit: (routine: Routine) => void;
  onRemove: (routine: Routine) => void;
}

/**
 * The Routines section of Profile: every routine, to open, edit or delete, and a way to add one.
 * A routine's name may have been written by a contact who sent it, so it is always isolated:
 * `<bdi>` where it is shown, U+2068/U+2069 in accessible names and the dialog title.
 */
export function RoutinesScreen({
  routines,
  errors,
  onBack,
  onNew,
  onOpen,
  onEdit,
  onRemove,
}: RoutinesScreenProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Routine | null>(null);
  const senderIds = useId();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.routines}</h1>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.back}
        </button>
      </header>

      {errors.map((error) => (
        <p key={error} className={styles.error} role="alert">
          {error}
        </p>
      ))}

      <button type="button" className={styles.primary} onClick={onNew}>
        {t.newRoutine}
      </button>

      {routines === null && <p className={styles.empty}>{t.loading}</p>}
      {routines?.length === 0 && <p className={styles.empty}>{t.noRoutines}</p>}
      {routines && routines.length > 0 && (
        <ul className={styles.list} aria-label={t.routines}>
          {routines.map((routine) => (
            <li key={routine.id} className={styles.item}>
              <button
                type="button"
                className={styles.summary}
                aria-label={t.openRoutine(isolate(routine.name))}
                aria-describedby={routine.receivedFrom ? `${senderIds}-${routine.id}` : undefined}
                onClick={() => {
                  onOpen(routine);
                }}
              >
                <span className={styles.text}>
                  <bdi className={styles.name}>{routine.name}</bdi>
                  {routine.receivedFrom && (
                    <ReceivedFrom
                      id={`${senderIds}-${routine.id}`}
                      className={styles.sender}
                      sender={routine.receivedFrom}
                    />
                  )}
                </span>
                <span className={styles.detail}>{t.stageCount(routine.stages.length)}</span>
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t.editRoutine(isolate(routine.name))}
                onClick={() => {
                  onEdit(routine);
                }}
              >
                <svg
                  className={styles.icon}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
                </svg>
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t.deleteRoutine(isolate(routine.name))}
                onClick={() => {
                  setPending(routine);
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <ConfirmDialog
          title={t.confirmDeleteRoutine(isolate(pending.name))}
          onConfirm={() => {
            setPending(null);
            onRemove(pending);
          }}
          onCancel={() => {
            setPending(null);
          }}
        />
      )}
    </main>
  );
}
