import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isGooglePhoto } from "../../directory/domain/directory";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { reportStoreFailure, storeFailureMessage } from "../../shared/ui/storeFailure";
import type { StoreFailureKind } from "../../shared/domain/storeFailure";
import type { LiveList } from "../../shared/ui/useLiveList";
import type { ContactList } from "../application/ports";
import { CONTACT_LIMITS, ContactRefused, type Contact } from "../domain/contact";
import styles from "./ContactsScreen.module.css";

interface ContactsScreenProps {
  list: ContactList;
  /** The contacts as read from `list`, which the caller keeps so Profile can count them. */
  contacts: LiveList<Contact>;
  /** The switch to be found by email, shown at the top; without it, none is offered. */
  findByEmail?: ReactNode;
  onBack: () => void;
}

/** The name shown for a contact: Google's, or the email they were added by when there is none. */
const shownName = ({ name, email }: Contact) => name || email;

/**
 * Wraps text in first-strong isolates, so a name written right to left, or one holding bidi
 * controls, cannot reorder the words of the message around it. For plain strings such as
 * accessible names and the dialog title; text rendered in the list uses `<bdi>`.
 */
const isolate = (text: string) => `\u2068${text}\u2069`;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** The first letter or digit of the name, else of the email; bidi controls and marks are skipped. */
function initialOf({ name, email }: Contact): string {
  const first = LETTER_OR_DIGIT.exec(name)?.[0] ?? LETTER_OR_DIGIT.exec(email)?.[0] ?? "?";
  return first.toLocaleUpperCase();
}

type Feedback = { kind: "added" } | { kind: "error"; message: string } | null;

/** A contact added on this device that the server later refused, by the add that kept it. */
interface SaveFailure {
  attempt: number;
  contact: Contact;
  kind: StoreFailureKind;
}

/**
 * The Contacts section of Profile: people added by the exact email they let others find them by,
 * shown with their Google photo or initial, and removed after confirming.
 */
export function ContactsScreen({ list, contacts: live, findByEmail, onBack }: ContactsScreenProps) {
  const { t } = useI18n();
  const inputId = useId();
  // Null until read: a failed first read is unknown, not empty, so it shows no count.
  const { items: contacts, failed } = live;
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [pending, setPending] = useState<Contact | null>(null);
  /** Kept apart from `feedback`, which belongs to the latest add, until this screen is left. */
  const [saveFailures, setSaveFailures] = useState<SaveFailure[]>([]);
  const attempts = useRef(0);
  /** The latest add that kept each contact, so an older add's late refusal is not told. */
  const latestAdd = useRef(new Map<string, number>());

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
    list
      .add(email)
      .then(
        ({ contact, saved }) => {
          setEmail("");
          setFeedback({ kind: "added" });
          attempts.current += 1;
          const attempt = attempts.current;
          latestAdd.current.set(contact.uid, attempt);
          setSaveFailures((current) =>
            current.filter((failure) => failure.contact.uid !== contact.uid),
          );
          // Not awaited: the server never answers offline, and the contact is already kept here.
          // If this screen was left meanwhile, the refusal is only logged.
          saved.catch((error: unknown) => {
            const kind = reportStoreFailure("Saving a contact", error);
            if (latestAdd.current.get(contact.uid) !== attempt) return;
            setSaveFailures((current) => [
              ...current.filter((failure) => failure.contact.uid !== contact.uid),
              { attempt, contact, kind },
            ]);
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
    list.remove(uid).catch((error: unknown) => {
      reportStoreFailure("Removing a contact", error);
      setRemoveFailed(true);
    });
  };

  /** Names the contact and says whether this device still shows them, as the list now does. */
  const saveFailureMessage = ({ contact, kind }: SaveFailure) => {
    const stillListed = contacts?.some(({ uid }) => uid === contact.uid) ?? false;
    const said = t.contactNotSaved(isolate(shownName(contact)), stillListed);
    // The shared not-found message names a workout; an unexplained failure needs no more words.
    return kind === "unknown" || kind === "notFound"
      ? said
      : `${said} ${storeFailureMessage(t, kind, "")}`;
  };

  const errors = [
    ...(feedback?.kind === "error" ? [{ key: "add", message: feedback.message }] : []),
    ...saveFailures.map((failure) => ({
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
              <Avatar contact={contact} />
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

/** Google's photo when there is one and it loads, otherwise the initial; the name sits beside it. */
function Avatar({ contact }: { contact: Contact }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  if (contact.photo && isGooglePhoto(contact.photo) && !photoFailed) {
    return (
      <img
        className={styles.avatar}
        src={contact.photo}
        alt=""
        // Google's image host rejects some referrers, and it does not need to know this app.
        referrerPolicy="no-referrer"
        onError={() => {
          setPhotoFailed(true);
        }}
      />
    );
  }
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initialOf(contact)}
    </span>
  );
}
