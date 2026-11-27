import { useId, useState } from "react";
import { isolate } from "../../i18n/messages/isolate";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { senderName, type Routine, type Sender } from "../domain/routine";
import { ReceivedFrom } from "./ReceivedFrom";
import styles from "./RoutinesScreen.module.css";

interface RoutinesScreenProps {
  /** Newest first; null until the first answer arrives. */
  routines: readonly Routine[] | null;
  errors: readonly string[];
  /** Received routines to mark New (T27); none by default. */
  newIds?: ReadonlySet<string>;
  /**
   * Copies a contact sent that could not be opened (T29 W5), each named by its sender, to delete
   * or to block the sender; none by default.
   */
  unopened?: readonly { id: string; sender: Sender }[];
  onDeleteUnopened?: (copyId: string) => void;
  /** Blocks a sender, after confirming; without it, no Block sender is offered. */
  onBlock?: (sender: Sender) => void;
  onBack: () => void;
  onNew: () => void;
  onOpen: (routine: Routine) => void;
  onEdit: (routine: Routine) => void;
  onRemove: (routine: Routine) => void;
  /** Shows older routines (T38); without it, none are left and no Show more is offered. */
  onShowMore?: () => void;
}

/**
 * The Routines section of Profile: the newest routines, to open, edit or delete, with Show more at
 * the end while older ones are left, and a way to add one.
 * A routine's name may have been written by a contact who sent it, so it is always isolated:
 * `<bdi>` where it is shown, U+2068/U+2069 in accessible names and the dialog title. A received
 * routine not seen before is marked New, which its accessible name says too.
 */
export function RoutinesScreen({
  routines,
  errors,
  newIds,
  unopened = [],
  onDeleteUnopened,
  onBlock,
  onBack,
  onNew,
  onOpen,
  onEdit,
  onRemove,
  onShowMore,
}: RoutinesScreenProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Routine | null>(null);
  const [blocking, setBlocking] = useState<Sender | null>(null);
  const senderIds = useId();
  /** A sender's own name (null when it shows nothing) and verified email, isolated: they wrote it. */
  const wordsFor = (sender: Sender) => {
    const name = senderName(sender);
    return [name === null ? null : isolate(name), isolate(sender.email)] as const;
  };

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

      {unopened.length > 0 && (
        <ul className={styles.unopened} aria-label={t.unopenedRoutines}>
          {unopened.map(({ id, sender }) => (
            <li key={id} className={styles.notice}>
              <p className={styles.noticeText}>
                <bdi>{t.unopenedRoutine(...wordsFor(sender))}</bdi>
              </p>
              <div className={styles.noticeActions}>
                {onDeleteUnopened && (
                  <button
                    type="button"
                    className={styles.noticeAction}
                    aria-label={t.deleteUnopenedRoutine(...wordsFor(sender))}
                    onClick={() => {
                      onDeleteUnopened(id);
                    }}
                  >
                    {t.confirmDelete}
                  </button>
                )}
                {onBlock && (
                  <button
                    type="button"
                    className={styles.noticeAction}
                    aria-label={t.blockSender(...wordsFor(sender))}
                    onClick={() => {
                      setBlocking(sender);
                    }}
                  >
                    {t.blockSenderAction}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

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
                aria-label={
                  newIds?.has(routine.id)
                    ? t.openNewRoutine(isolate(routine.name))
                    : t.openRoutine(isolate(routine.name))
                }
                aria-describedby={routine.receivedFrom ? `${senderIds}-${routine.id}` : undefined}
                onClick={() => {
                  onOpen(routine);
                }}
              >
                <span className={styles.text}>
                  {newIds?.has(routine.id) && (
                    <span className={styles.new} aria-hidden="true">
                      {t.newRoutineMark}
                    </span>
                  )}
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
      {routines && routines.length > 0 && onShowMore && (
        <button type="button" className={styles.showMore} onClick={onShowMore}>
          {t.showMore}
        </button>
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

      {blocking && onBlock && (
        <ConfirmDialog
          title={t.confirmBlockSender(...wordsFor(blocking))}
          message={t.blockSenderNote}
          confirmLabel={t.blockAction}
          onConfirm={() => {
            setBlocking(null);
            onBlock(blocking);
          }}
          onCancel={() => {
            setBlocking(null);
          }}
        />
      )}
    </main>
  );
}
