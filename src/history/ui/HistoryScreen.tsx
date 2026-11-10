import { useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { useLiveList } from "../../shared/ui/useLiveList";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { formatClock } from "../../timer/domain/format";
import { MARK_KINDS } from "../../workouts/domain/workout";
import type { HistoryLog } from "../application/ports";
import type { HistoryEntry } from "../domain/historyEntry";
import styles from "./HistoryScreen.module.css";

interface HistoryScreenProps {
  log: HistoryLog;
  onBack(): void;
}

export function HistoryScreen({ log, onBack }: HistoryScreenProps) {
  const { t, language } = useI18n();
  const { items, failed } = useLiveList(log.subscribe);
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const [pending, setPending] = useState<HistoryEntry | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);

  const remove = (entry: HistoryEntry) => {
    setPending(null);
    setRemoveFailed(false);
    log.remove(entry.id).catch(() => {
      setRemoveFailed(true);
    });
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.history}</h1>
        <button className={styles.back} onClick={onBack}>
          {t.back}
        </button>
      </header>

      {failed && (
        <p className={styles.error} role="alert">
          {t.loadHistoryFailed}
        </p>
      )}

      {removeFailed && (
        <p className={styles.error} role="alert">
          {t.deleteSessionFailed}
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
