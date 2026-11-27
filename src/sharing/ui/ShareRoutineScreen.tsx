import { useEffect, useId, useRef, useState } from "react";
import type { Contact } from "../../contacts/domain/contact";
import { ContactAvatar, shownName } from "../../contacts/ui/ContactAvatar";
import { isolate } from "../../i18n/messages/isolate";
import { useI18n } from "../../i18n/ui/I18nProvider";
import type { Routine } from "../../routines/domain/routine";
import {
  reportStoreFailure,
  storeFailureMessage,
  storeFailureReason,
} from "../../shared/ui/storeFailure";
import type { LiveList } from "../../shared/ui/useLiveList";
import type { Delivery, RoutineSharing, Share } from "../application/ports";
import type { ShareProblem } from "../domain/sharedCopy";
import styles from "./ShareRoutineScreen.module.css";

interface ShareRoutineScreenProps {
  routine: Routine;
  /** The user's saved contacts, as the caller reads them. */
  liveContacts: LiveList<Contact>;
  sharing: RoutineSharing;
  onBack: () => void;
  onOpenContacts: () => void;
}

/** Picking the recipients, confirming, then each recipient's result. */
type Step = "pick" | "confirm" | "results";

type Refusal = { kind: "problems"; problems: ShareProblem[] } | { kind: "message"; text: string };

/** An exercise's name is the user's own text: isolated, so it cannot reorder the message. */
const isolated = (problem: ShareProblem): ShareProblem =>
  problem.kind === "exercise" && problem.exerciseName !== undefined
    ? { ...problem, exerciseName: isolate(problem.exerciseName) }
    : problem;

/**
 * Sends a copy of a routine to some of the user's contacts (S12): pick them, confirm, then see
 * what became of each copy. Nothing is written before confirming, and nothing is queued: without
 * a connection it says so. A retry reuses the same copies, so it never delivers one twice.
 */
export function ShareRoutineScreen({
  routine,
  liveContacts,
  sharing,
  onBack,
  onOpenContacts,
}: ShareRoutineScreenProps) {
  const { t } = useI18n();
  const resultsId = useId();
  const { items: contacts, failed } = liveContacts;
  const [step, setStep] = useState<Step>("pick");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  // Read and set at once, so a second press before the first re-renders sends nothing.
  const busy = useRef(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  /** Prepared once per confirmation, with each recipient's copy id; a retry sends it again. */
  const [share, setShare] = useState<Share | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);

  // Each step starts where a screen reader should read on.
  useEffect(() => {
    if (step === "confirm") questionRef.current?.focus();
    if (step === "results") resultsRef.current?.focus();
  }, [step, deliveries]);

  const recipients = share?.recipients ?? (contacts ?? []).filter(({ uid }) => chosen.has(uid));

  const toggle = (uid: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(uid)) next.add(uid);
      return next;
    });
  };

  const send = async () => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setRefusal(null);
    try {
      let current = share;
      if (current === null) {
        const preparation = await sharing.prepare(routine, recipients);
        switch (preparation.kind) {
          case "refused":
            setRefusal({ kind: "problems", problems: preparation.problems });
            return;
          case "offline":
            setRefusal({ kind: "message", text: t.shareNeedsConnection });
            return;
          case "failed": {
            // The shared not-found message names a workout.
            const kind = preparation.failure === "notFound" ? "unknown" : preparation.failure;
            setRefusal({ kind: "message", text: storeFailureMessage(t, kind, t.shareFailed) });
            return;
          }
          case "ready":
            current = preparation.share;
            setShare(current);
        }
      }
      setDeliveries(await current.send());
      setStep("results");
    } catch (error: unknown) {
      reportStoreFailure("Sharing a routine", error);
      setRefusal({ kind: "message", text: t.shareFailed });
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  const outcomeText = ({ outcome, failure }: Delivery) => {
    const said = t.shareOutcomes[outcome];
    const reason =
      outcome === "failed" && failure !== undefined && failure !== "notFound"
        ? storeFailureReason(t, failure)
        : null;
    return reason === null ? said : `${said} ${reason}`;
  };

  const refusalAlert = refusal && (
    <div className={styles.error} role="alert">
      {refusal.kind === "message" ? (
        <p className={styles.errorText}>{refusal.text}</p>
      ) : (
        <>
          <p className={styles.errorText}>{t.shareCannotSend}</p>
          <ul className={styles.problems}>
            {refusal.problems.map((problem, index) => (
              <li key={index}>{t.shareProblem(isolated(problem))}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.shareTitle}</h1>
        <button type="button" className={styles.back} onClick={onBack} disabled={sending}>
          {t.back}
        </button>
      </header>
      <p className={styles.routine}>
        <bdi>{routine.name}</bdi>
      </p>

      {step === "pick" && (
        <>
          {failed && (
            <p className={styles.error} role="alert">
              {t.loadContactsFailed}
            </p>
          )}
          {contacts === null && !failed && <p className={styles.empty}>{t.loading}</p>}
          {contacts?.length === 0 && (
            <>
              <p className={styles.empty}>{t.shareNoContacts}</p>
              <button type="button" className={styles.secondary} onClick={onOpenContacts}>
                {t.shareOpenContacts}
              </button>
            </>
          )}
          {contacts && contacts.length > 0 && (
            <>
              <fieldset className={styles.picker}>
                <legend className={styles.legend}>{t.shareChooseContacts}</legend>
                <ul className={styles.list}>
                  {contacts.map((contact) => (
                    <PickedContact
                      key={contact.uid}
                      contact={contact}
                      checked={chosen.has(contact.uid)}
                      onToggle={() => {
                        toggle(contact.uid);
                      }}
                    />
                  ))}
                </ul>
              </fieldset>
              <button
                type="button"
                className={styles.primary}
                disabled={recipients.length === 0}
                onClick={() => {
                  setRefusal(null);
                  setStep("confirm");
                }}
              >
                {t.shareContinue}
              </button>
            </>
          )}
        </>
      )}

      {step === "confirm" && (
        <section className={styles.step}>
          <h2 ref={questionRef} className={styles.question} tabIndex={-1}>
            {t.confirmShare(
              isolate(routine.name),
              recipients.map((contact) => isolate(shownName(contact))),
            )}
          </h2>
          <p className={styles.note}>{t.shareNote}</p>
          {refusalAlert}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={sending}
              onClick={() => {
                setRefusal(null);
                setStep("pick");
              }}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={sending}
              onClick={() => {
                void send();
              }}
            >
              {sending ? t.shareSending : t.shareSend}
            </button>
          </div>
        </section>
      )}

      {step === "results" && deliveries && (
        <section className={styles.step}>
          <h2 ref={resultsRef} id={resultsId} className={styles.question} tabIndex={-1}>
            {t.shareResults}
          </h2>
          <ul className={styles.list} aria-labelledby={resultsId}>
            {deliveries.map((delivery) => (
              <li key={delivery.contact.uid} className={styles.item}>
                <ContactAvatar contact={delivery.contact} className={styles.avatar} />
                <span className={styles.identity}>
                  <bdi className={styles.name}>{shownName(delivery.contact)}</bdi>
                  <span className={delivery.outcome === "sent" ? styles.sent : styles.outcome}>
                    {outcomeText(delivery)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {refusalAlert}
          <div className={styles.actions}>
            {deliveries.some(({ outcome }) => outcome !== "sent") && (
              <button
                type="button"
                className={styles.secondary}
                disabled={sending}
                onClick={() => {
                  void send();
                }}
              >
                {sending ? t.shareSending : t.tryAgain}
              </button>
            )}
            <button type="button" className={styles.primary} disabled={sending} onClick={onBack}>
              {t.shareDone}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

interface PickedContactProps {
  contact: Contact;
  checked: boolean;
  onToggle: () => void;
}

/** A contact to pick, with their photo or initial; named isolated, described by their email. */
function PickedContact({ contact, checked, onToggle }: PickedContactProps) {
  const emailId = useId();
  return (
    <li>
      <label className={styles.item}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          aria-label={isolate(shownName(contact))}
          aria-describedby={contact.name ? emailId : undefined}
          onChange={onToggle}
        />
        <ContactAvatar contact={contact} className={styles.avatar} />
        <span className={styles.identity}>
          <bdi className={styles.name}>{shownName(contact)}</bdi>
          {contact.name && (
            <bdi id={emailId} className={styles.email}>
              {contact.email}
            </bdi>
          )}
        </span>
      </label>
    </li>
  );
}
