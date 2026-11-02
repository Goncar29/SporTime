export type WorkoutMode = "stopwatch" | "forTime" | "amrap" | "emom" | "tabata" | "intervals";

export interface WorkoutConfig {
  mode: WorkoutMode;
  prepareSeconds: number;
  workSeconds: number;
  restSeconds: number;
  rounds: number;
  sets: number;
  setRestSeconds: number;
}

export type NumericField = Exclude<keyof WorkoutConfig, "mode">;

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
  defaults: Omit<WorkoutConfig, "mode">;
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
  return config;
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
