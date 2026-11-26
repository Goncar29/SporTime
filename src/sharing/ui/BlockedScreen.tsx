import { isolate } from "../../i18n/messages/isolate";
import { useI18n } from "../../i18n/ui/I18nProvider";
import type { LiveList } from "../../shared/ui/useLiveList";
import { senderName } from "../../routines/domain/routine";
import { shownSenderName, type BlockedSender } from "../domain/blockedSender";
import styles from "./BlockedScreen.module.css";

interface BlockedScreenProps {
  /** Who the user blocked, as the caller reads them. */
  liveBlocked: LiveList<BlockedSender>;
  /** Failures to tell, such as a refused unblock. */
  errors: readonly string[];
  /** Not awaited: the unblock shows here at once, and the server may answer much later. */
  onUnblock: (sender: BlockedSender) => void;
  onBack: () => void;
}

/**
 * The people the user blocked from sending them routines (T27, S7), reached from Contacts, each
 * with their name and email and a way to unblock them. Both were written by them, so both are
 * isolated: `<bdi>` where shown, U+2068/U+2069 in accessible names.
 */
export function BlockedScreen({ liveBlocked, errors, onUnblock, onBack }: BlockedScreenProps) {
  const { t } = useI18n();
  const { items, failed } = liveBlocked;
  const shownErrors = [...errors, ...(failed ? [t.loadBlockedFailed] : [])];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.blocked}</h1>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.back}
        </button>
      </header>

      {shownErrors.map((error) => (
        <p key={error} className={styles.error} role="alert">
          {error}
        </p>
      ))}

      {items === null && !failed && <p className={styles.empty}>{t.loading}</p>}
      {items?.length === 0 && <p className={styles.empty}>{t.noBlocked}</p>}
      {items && items.length > 0 && (
        <ul className={styles.list} aria-label={t.blocked}>
          {items.map((sender) => (
            <li key={sender.uid} className={styles.item}>
              <span className={styles.identity}>
                <bdi className={styles.name}>{shownSenderName(sender)}</bdi>
                {senderName(sender) !== null && <bdi className={styles.email}>{sender.email}</bdi>}
              </span>
              <button
                type="button"
                className={styles.unblock}
                aria-label={t.unblockSender(isolate(shownSenderName(sender)))}
                onClick={() => {
                  onUnblock(sender);
                }}
              >
                {t.unblock}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
