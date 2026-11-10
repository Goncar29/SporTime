import type { SubscribeToList } from "../../shared/application/liveList";
import type { HistoryDraft, HistoryEntry } from "../domain/historyEntry";

/** One user's finished sessions, newest first. Writes apply locally right away and sync when online. */
export interface HistoryLog {
  subscribe: SubscribeToList<HistoryEntry>;
  /** Settles when the server answers, which never happens offline, so callers must not wait for it. */
  add(draft: HistoryDraft): Promise<void>;
  /** Settles when the server answers; the entry disappears from the list right away. */
  remove(id: string): Promise<void>;
}
