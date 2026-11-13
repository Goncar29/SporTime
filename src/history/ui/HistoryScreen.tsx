import { useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import type { StoreFailureKind } from "../../shared/domain/storeFailure";
import { reportStoreFailure, storeFailureMessage } from "../../shared/ui/storeFailure";
import { useLiveList } from "../../shared/ui/useLiveList";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { formatClock } from "../../timer/domain/format";
import { MARK_KINDS } from "../../workouts/domain/workout";
import type { HistoryLog } from "../application/ports";
import type { HistoryEntry } from "../domain/historyEntry";
import styles from "./HistoryScreen.module.css";

interface HistoryScreenProps {
  log: HistoryLog;
}

export function HistoryScreen({ log }: HistoryScreenProps) {
  const { t, language } = useI18n();
  const { items, failed, failure } = useLiveList(log.subscribe, "Loading the history");
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const [pending, setPending] = useState<HistoryEntry | null>(null);
  const [removeFailure, setRemoveFailure] = useState<StoreFailureKind | null>(null);

  const remove = (entry: HistoryEntry) => {
    setPending(null);
    setRemoveFailure(null);
    log.remove(entry.id).catch((error: unknown) => {
      setRemoveFailure(reportStoreFailure("Deleting a finished session", error));
    });
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.history}</h1>
      </header>

      {failed && (
        <p className={styles.error} role="alert">
          {storeFailureMessage(t, failure ?? "unknown", t.loadHistoryFailed)}
        </p>
      )}

      {removeFailure && (
        <p className={styles.error} role="alert">
          {storeFailureMessage(t, removeFailure, t.deleteSessionFailed)}
        </p>
      )}

      {items === null && !failed && <p className={styles.empty}>{t.loading}</p>}

      {items?.length === 0 && !failed && <p className={styles.empty}>{t.historyEmpty}</p>}

      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((entry) => {
            const markKind = MARK_KINDS[entry.config.mode];
            return (
              <li key={entry.id} className={styles.item}>
                <span className={styles.mode}>{t.modes[entry.config.mode].label}</span>
                <span className={styles.time}>{formatClock(entry.activeMs)}</span>
                <span className={styles.detail}>{dates.format(entry.finishedAt)}</span>
                {markKind && (
                  <span className={styles.detail}>{t[markKind].count(entry.marks)}</span>
                )}
                <button
                  className={styles.remove}
                  aria-label={t.deleteSession(dates.format(entry.finishedAt))}
                  onClick={() => {
                    setPending(entry);
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pending && (
        <ConfirmDialog
          title={t.confirmDeleteSession}
          onConfirm={() => {
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
