export type WorkoutMode = "stopwatch" | "forTime" | "amrap" | "emom" | "tabata" | "intervals";

export interface WorkoutConfig {
  mode: WorkoutMode;
  prepareSeconds: number;
  workSeconds: number;
  restSeconds: number;
  rounds: number;
  sets: number;
  setRestSeconds: number;
  /**
   * The name of each round's work, by round; `""` leaves a round with the default name.
   * Left out when no round has a name, so configs without names keep their old shape.
   */
  roundNames?: readonly string[];
}

export type NumericField = Exclude<keyof WorkoutConfig, "mode" | "roundNames">;

export type FieldId =
  | "prepare"
  | "timeCap"
  | "duration"
  | "every"
  | "work"
  | "rest"
  | "rounds"
  | "sets"
  | "setRest";

export interface FieldDefinition {
  id: FieldId;
  key: NumericField;
  kind: "duration" | "count";
}

export interface ModeDefinition {
  id: WorkoutMode;
  fields: readonly FieldDefinition[];
  defaults: Omit<WorkoutConfig, "mode" | "roundNames">;
}

export const LIMITS: Record<NumericField, { min: number; max: number }> = {
  prepareSeconds: { min: 0, max: 300 },
  workSeconds: { min: 1, max: 10_800 },
  restSeconds: { min: 0, max: 3_600 },
  rounds: { min: 1, max: 99 },
  sets: { min: 1, max: 20 },
  setRestSeconds: { min: 0, max: 3_600 },
};

const PREPARE: FieldDefinition = { id: "prepare", key: "prepareSeconds", kind: "duration" };
const WORK: FieldDefinition = { id: "work", key: "workSeconds", kind: "duration" };
const REST: FieldDefinition = { id: "rest", key: "restSeconds", kind: "duration" };
const ROUNDS: FieldDefinition = { id: "rounds", key: "rounds", kind: "count" };
const SETS: FieldDefinition = { id: "sets", key: "sets", kind: "count" };
const SET_REST: FieldDefinition = { id: "setRest", key: "setRestSeconds", kind: "duration" };

const BASE = {
  prepareSeconds: 10,
  workSeconds: 60,
  restSeconds: 0,
  rounds: 1,
  sets: 1,
  setRestSeconds: 60,
};

export const MODES: readonly ModeDefinition[] = [
  {
    id: "stopwatch",
    fields: [PREPARE],
    defaults: { ...BASE, prepareSeconds: 0 },
  },
  {
    id: "forTime",
    fields: [PREPARE, { ...WORK, id: "timeCap" }, SETS, SET_REST],
    defaults: { ...BASE, workSeconds: 1_200, setRestSeconds: 120 },
  },
  {
    id: "amrap",
    fields: [PREPARE, { ...WORK, id: "duration" }, SETS, SET_REST],
    defaults: { ...BASE, workSeconds: 720, setRestSeconds: 120 },
  },
  {
    id: "emom",
    fields: [PREPARE, { ...WORK, id: "every" }, ROUNDS, SETS, SET_REST],
    defaults: { ...BASE, workSeconds: 60, rounds: 10 },
  },
  {
    id: "tabata",
    fields: [PREPARE, WORK, REST, ROUNDS, SETS, SET_REST],
    defaults: { ...BASE, workSeconds: 20, restSeconds: 10, rounds: 8 },
  },
  {
    id: "intervals",
    fields: [PREPARE, WORK, REST, ROUNDS, SETS, SET_REST],
    defaults: { ...BASE, workSeconds: 40, restSeconds: 20, rounds: 5 },
  },
];

/** Modes where the athlete counts something by hand while the clock runs. */
export const MARK_KINDS: Partial<Record<WorkoutMode, "lapMark" | "roundMark">> = {
  stopwatch: "lapMark",
  amrap: "roundMark",
};

export function modeDefinition(mode: WorkoutMode): ModeDefinition {
  const definition = MODES.find((candidate) => candidate.id === mode);
  if (!definition) throw new Error(`Unknown workout mode: ${String(mode)}`);
  return definition;
}

export function defaultConfig(mode: WorkoutMode): WorkoutConfig {
  return { mode, ...modeDefinition(mode).defaults };
}

/** Measured like a workout name; `firestore/firestore.rules` enforces the same limit. */
export const MAX_ROUND_NAME_LENGTH = 24;

/** Only modes with rounds of work can name them. */
export function hasRoundNames(mode: WorkoutMode): boolean {
  return modeDefinition(mode).fields.some(({ key }) => key === "rounds");
}

/** A trimmed round name, or `""` when the round keeps the default name. */
export function normalizeRoundName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const name = raw.trim();
  const hasVisibleCharacter = /[^\p{C}\p{Z}]/u.test(name);
  const valid =
    hasVisibleCharacter && name.length <= MAX_ROUND_NAME_LENGTH && !/\p{Cc}/u.test(name);
  return valid ? name : "";
}

/** Joins round names in stored data, where a name can never hold a control character. */
const ROUND_NAME_SEPARATOR = "\n";

/** Reads names as the app keeps them (a list) or as Firestore stores them (one per line). */
function sanitizeRoundNames(raw: unknown, rounds: number): string[] {
  const list: unknown[] | null =
    typeof raw === "string" ? raw.split(ROUND_NAME_SEPARATOR) : Array.isArray(raw) ? raw : null;
  if (!list) return [];
  const names = list.slice(0, rounds).map(normalizeRoundName);
  while (names.length > 0 && names.at(-1) === "") names.pop();
  return names;
}

export function clampField(key: NumericField, value: number): number {
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Builds a valid config from untrusted data. Only the fields the mode exposes
 * are read, so values left over from another mode can never alter its timeline.
 */
export function sanitizeConfig(mode: WorkoutMode, raw: unknown): WorkoutConfig {
  const config = defaultConfig(mode);
  if (typeof raw !== "object" || raw === null) return config;
  const source = raw as Partial<Record<NumericField, unknown>>;
  for (const { key } of modeDefinition(mode).fields) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      config[key] = clampField(key, value);
    }
  }
  if (hasRoundNames(mode)) {
    const roundNames = sanitizeRoundNames(
      (raw as { roundNames?: unknown }).roundNames,
      config.rounds,
    );
    if (roundNames.length > 0) config.roundNames = roundNames;
  }
  return config;
}

/** True when two configs hold the same settings, whatever order their fields were written in. */
export function sameConfig(a: WorkoutConfig, b: WorkoutConfig): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof WorkoutConfig>;
  return [...keys].every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/** A config as Firestore stores it: round names become one string so the rules can check them. */
export type StoredConfig = Omit<WorkoutConfig, "roundNames"> & { roundNames?: string };

/**
 * The config to write to Firestore. Without names it keeps the shape it had before
 * rounds could be named, so older rules and clients accept it unchanged.
 */
export function toStoredConfig(config: WorkoutConfig): StoredConfig {
  const { roundNames, ...rest } = sanitizeConfig(config.mode, config);
  return roundNames ? { ...rest, roundNames: roundNames.join(ROUND_NAME_SEPARATOR) } : rest;
}

/** Reads a stored config, or returns null when its mode is unknown. */
export function parseConfig(raw: unknown): WorkoutConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const definition = MODES.find(({ id }) => id === (raw as { mode?: unknown }).mode);
  return definition ? sanitizeConfig(definition.id, raw) : null;
}

function durationStep(seconds: number): number {
  if (seconds < 60) return 5;
  if (seconds < 300) return 15;
  if (seconds < 1_200) return 60;
  return 300;
}

/** Moves a duration to the next friendly value: finer when short, coarser when long. */
export function stepDuration(seconds: number, direction: 1 | -1): number {
  if (direction === 1) {
    const step = durationStep(seconds);
    return (Math.floor(seconds / step) + 1) * step;
  }
  const step = durationStep(seconds - 1);
  return Math.max(0, (Math.ceil(seconds / step) - 1) * step);
}

/** The value a stepper moves to; equals `value` when it has reached its limit. */
export function stepField(field: FieldDefinition, value: number, direction: 1 | -1): number {
  const next = field.kind === "duration" ? stepDuration(value, direction) : value + direction;
  return clampField(field.key, next);
}
