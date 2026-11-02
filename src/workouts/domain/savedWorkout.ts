import { isTimestamp } from "../../shared/domain/timestamp";
import { parseConfig, type WorkoutConfig } from "./workout";

export const MAX_WORKOUT_NAME_LENGTH = 40;

export interface SavedWorkoutDraft {
  name: string;
  config: WorkoutConfig;
  createdAt: number;
}

export interface SavedWorkout extends SavedWorkoutDraft {
  id: string;
}

export function normalizeWorkoutName(raw: string): string | null {
  const name = raw.trim();
  const hasVisibleCharacter = /[^\p{C}\p{Z}]/u.test(name);
  return hasVisibleCharacter && name.length <= MAX_WORKOUT_NAME_LENGTH ? name : null;
}

export function parseSavedWorkout(id: string, raw: unknown): SavedWorkout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, config, createdAt } = raw as Record<string, unknown>;
  const parsedConfig = parseConfig(config);
  if (typeof name !== "string" || !isTimestamp(createdAt) || !parsedConfig) return null;
  return { id, name, config: parsedConfig, createdAt };
}
