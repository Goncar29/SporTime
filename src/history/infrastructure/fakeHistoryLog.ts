import { createFakeStoredList } from "../../shared/infrastructure/fakeStoredList";
import type { HistoryLog } from "../application/ports";
import type { HistoryDraft, HistoryEntry } from "../domain/historyEntry";

export function createFakeHistoryLog(userId: string): HistoryLog {
  const list = createFakeStoredList<HistoryDraft, HistoryEntry>(
    `sportime.fakeHistory.${userId}`,
    (a, b) => b.finishedAt - a.finishedAt,
  );
  return { subscribe: list.subscribe, add: list.add };
}
