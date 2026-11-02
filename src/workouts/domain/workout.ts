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

type NumericField = Exclude<keyof WorkoutConfig, "mode">;

export interface FieldDefinition {
  key: NumericField;
  label: string;
  kind: "duration" | "count";
}

export interface ModeDefinition {
  id: WorkoutMode;
  label: string;
  description: string;
  fields: readonly FieldDefinition[];
  defaults: Omit<WorkoutConfig, "mode">;
}

const LIMITS: Record<NumericField, { min: number; max: number }> = {
  prepareSeconds: { min: 0, max: 300 },
  workSeconds: { min: 1, max: 10_800 },
  restSeconds: { min: 0, max: 3_600 },
  rounds: { min: 1, max: 99 },
  sets: { min: 1, max: 20 },
  setRestSeconds: { min: 0, max: 3_600 },
};

const PREPARE: FieldDefinition = { key: "prepareSeconds", label: "Get ready", kind: "duration" };
const SETS: FieldDefinition = { key: "sets", label: "Sets", kind: "count" };
const SET_REST: FieldDefinition = {
  key: "setRestSeconds",
  label: "Rest between sets",
  kind: "duration",
};
const ROUNDS: FieldDefinition = { key: "rounds", label: "Rounds", kind: "count" };

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
    label: "Stopwatch",
    description: "Count up with no limit and record laps.",
    fields: [PREPARE],
    defaults: { ...BASE, prepareSeconds: 0 },
  },
  {
    id: "forTime",
    label: "For Time",
    description: "Finish the work as fast as you can, up to a time cap.",
    fields: [PREPARE, { key: "workSeconds", label: "Time cap", kind: "duration" }, SETS, SET_REST],
    defaults: { ...BASE, workSeconds: 1_200, setRestSeconds: 120 },
  },
  {
    id: "amrap",
    label: "AMRAP",
    description: "As many rounds as possible in a fixed time.",
    fields: [PREPARE, { key: "workSeconds", label: "Duration", kind: "duration" }, SETS, SET_REST],
    defaults: { ...BASE, workSeconds: 720, setRestSeconds: 120 },
  },
  {
    id: "emom",
    label: "EMOM",
    description: "Start your work at the top of every interval.",
    fields: [
      PREPARE,
      { key: "workSeconds", label: "Every", kind: "duration" },
      ROUNDS,
      SETS,
      SET_REST,
    ],
    defaults: { ...BASE, workSeconds: 60, rounds: 10 },
  },
  {
    id: "tabata",
    label: "Tabata",
    description: "Short, all-out efforts with brief rests.",
    fields: [
      PREPARE,
      { key: "workSeconds", label: "Work", kind: "duration" },
      { key: "restSeconds", label: "Rest", kind: "duration" },
      ROUNDS,
      SETS,
      SET_REST,
    ],
    defaults: { ...BASE, workSeconds: 20, restSeconds: 10, rounds: 8 },
  },
  {
    id: "intervals",
    label: "Intervals",
    description: "Build your own work and rest cycles.",
    fields: [
      PREPARE,
      { key: "workSeconds", label: "Work", kind: "duration" },
      { key: "restSeconds", label: "Rest", kind: "duration" },
      ROUNDS,
      SETS,
      SET_REST,
    ],
    defaults: { ...BASE, workSeconds: 40, restSeconds: 20, rounds: 5 },
  },
];

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
