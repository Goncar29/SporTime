import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import {
  reportStoreFailure,
  storeFailureMessage,
  storeFailureReason,
} from "../../shared/ui/storeFailure";
import type { LiveList } from "../../shared/ui/useLiveList";
import type { ContactStore } from "../application/ports";
import { CONTACT_LIMITS, ContactRefused, type Contact } from "../domain/contact";
import { ContactAvatar, isolate, shownName } from "./ContactAvatar";
import styles from "./ContactsScreen.module.css";
import type { ContactSaveFailure, ContactSaveFailures } from "./useContactSaveFailures";

interface ContactsScreenProps {
  /** Where contacts are added and removed. */
  contactStore: ContactStore;
  /** The contacts as read from `contactStore`, which the caller keeps so Profile can count them. */
  liveContacts: LiveList<Contact>;
  /** Late server refusals of adds, which the caller keeps so leaving this screen does not lose them. */
  saveFailures: ContactSaveFailures;
  /** The switch to be found by email, shown at the top; without it, none is offered. */
  findByEmail?: ReactNode;
  /** Opens the list of blocked senders (T27); without it, none is offered. */
  onOpenBlocked?: () => void;
  onBack: () => void;
}

type Feedback = { kind: "added" } | { kind: "error"; message: string } | null;

/**
 * The Contacts section of Profile: people added by the exact email they let others find them by,
 * shown with their Google photo or initial, and removed after confirming.
 */
export function ContactsScreen({
  contactStore,
  liveContacts,
  saveFailures,
  findByEmail,
  onOpenBlocked,
  onBack,
}: ContactsScreenProps) {
  const { t } = useI18n();
  const inputId = useId();
  // Null until read: a failed first read is unknown, not empty, so it shows no count.
  const { items: contacts, failed } = liveContacts;
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [pending, setPending] = useState<Contact | null>(null);

  /** Anything but a refusal is told in general terms; only its code is logged, never its text. */
  const failureMessage = (operation: string, error: unknown) => {
    const kind = reportStoreFailure(operation, error);
    // The shared not-found message names a workout.
    return storeFailureMessage(t, kind === "notFound" ? "unknown" : kind, t.addContactFailed);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (adding || email.trim() === "") return;
    setAdding(true);
    setFeedback(null);
    setRemoveFailed(false);
    contactStore
      .add(email)
      .then(
        (added) => {
          setEmail("");
          const addedFeedback: Feedback = { kind: "added" };
          setFeedback(addedFeedback);
          // Kept by the caller, so a refusal that arrives after leaving this screen is not lost.
          saveFailures.track(added);
          // A refusal of this add tells what became of it, so it no longer says it was added.
          added.saved.catch(() => {
            setFeedback((current) => (current === addedFeedback ? null : current));
          });
        },
        (error: unknown) => {
          setFeedback({
            kind: "error",
            message:
              error instanceof ContactRefused
                ? t.contactRefusals[error.kind]
                : failureMessage("Adding a contact", error),
          });
        },
      )
      .finally(() => {
        setAdding(false);
      });
  };

  const remove = ({ uid }: Contact) => {
    setFeedback(null);
    setRemoveFailed(false);
    // Not awaited: the server never answers offline, and the removal already shows here.
    contactStore.remove(uid).catch((error: unknown) => {
      reportStoreFailure("Removing a contact", error);
      setRemoveFailed(true);
    });
  };

  /** Names the contact and says whether this device still shows them, as the list now does. */
  const saveFailureMessage = ({ contact, kind }: ContactSaveFailure) => {
    const stillListed = contacts?.some(({ uid }) => uid === contact.uid) ?? false;
    const said = t.contactNotSaved(isolate(shownName(contact)), stillListed);
    // The shared not-found message names a workout; an unexplained failure needs no more words.
    const reason = kind === "notFound" ? null : storeFailureReason(t, kind);
    return reason === null ? said : `${said} ${reason}`;
  };

  const errors = [
    ...(feedback?.kind === "error" ? [{ key: "add", message: feedback.message }] : []),
    ...saveFailures.failures.map((failure) => ({
      key: `saved-${String(failure.attempt)}`,
      message: saveFailureMessage(failure),
    })),
    ...(removeFailed ? [{ key: "remove", message: t.removeContactFailed }] : []),
    ...(failed ? [{ key: "load", message: t.loadContactsFailed }] : []),
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.contacts}</h1>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.back}
        </button>
      </header>

      {findByEmail}

      <form className={styles.add} noValidate onSubmit={submit}>
        <label className={styles.label} htmlFor={inputId}>
          {t.contactEmail}
        </label>
        <div className={styles.addRow}>
          <input
            id={inputId}
            className={styles.input}
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            value={email}
            disabled={adding}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <button type="submit" className={styles.primary} disabled={adding || email.trim() === ""}>
            {adding ? t.addingContact : t.addContact}
          </button>
        </div>
      </form>

      {errors.map(({ key, message }) => (
        <p key={key} className={styles.error} role="alert">
          {message}
        </p>
      ))}
      {feedback?.kind === "added" && (
        <p className={styles.added} role="status">
          {t.contactAdded}
        </p>
      )}

      {contacts === null && !failed && <p className={styles.empty}>{t.loading}</p>}
      {contacts && (
        <p className={styles.count}>{t.contactCount(contacts.length, CONTACT_LIMITS.contacts)}</p>
      )}
      {contacts?.length === 0 && <p className={styles.empty}>{t.noContacts}</p>}
      {contacts && contacts.length > 0 && (
        <ul className={styles.list} aria-label={t.contacts}>
          {contacts.map((contact) => (
            <li key={contact.uid} className={styles.item}>
              <ContactAvatar contact={contact} className={styles.avatar} />
              <span className={styles.identity}>
                <bdi className={styles.name}>{shownName(contact)}</bdi>
                {contact.name && <bdi className={styles.email}>{contact.email}</bdi>}
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t.removeContact(isolate(shownName(contact)))}
                onClick={() => {
                  setPending(contact);
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {onOpenBlocked && (
        <button type="button" className={styles.secondary} onClick={onOpenBlocked}>
          {t.blocked}
        </button>
      )}

      {pending && (
        <ConfirmDialog
          title={t.confirmRemoveContact(isolate(shownName(pending)))}
          message={t.removeContactNote}
          confirmLabel={t.confirmRemoveContactAction}
          onConfirm={() => {
            setPending(null);
            remove(pending);
          }}
          onCancel={() => {
            setPending(null);
          }}
        />
      )}
    </main>
  );
}
