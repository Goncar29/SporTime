import { parseConfig, type WorkoutConfig } from "../../workouts/domain/workout";

/** One week and 10,000 marks; `firestore/firestore.rules` enforces the same limits. */
export const MAX_ACTIVE_MS = 604_800_000;
export const MAX_MARKS = 10_000;

export interface HistoryDraft {
  config: WorkoutConfig;
  finishedAt: number;
  activeMs: number;
  marks: number;
}

export interface HistoryEntry extends HistoryDraft {
  id: string;
}

interface FinishedSession {
  config: WorkoutConfig;
  activeElapsedMs: number;
  markCount: number;
  now: number;
}

export function createHistoryDraft({
  config,
  activeElapsedMs,
  markCount,
  now,
}: FinishedSession): HistoryDraft {
  return {
    config,
    finishedAt: now,
    activeMs: Math.min(MAX_ACTIVE_MS, Math.trunc(activeElapsedMs)),
    marks: Math.min(MAX_MARKS, markCount),
  };
}

export function parseHistoryEntry(id: string, raw: unknown): HistoryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { config, finishedAt, activeMs, marks } = raw as Record<string, unknown>;
  const parsedConfig = parseConfig(config);
  if (
    !parsedConfig ||
    typeof finishedAt !== "number" ||
    typeof activeMs !== "number" ||
    typeof marks !== "number"
  ) {
    return null;
  }
  return { id, config: parsedConfig, finishedAt, activeMs, marks };
}
