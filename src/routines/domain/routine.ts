import { isTimestamp } from "../../shared/domain/timestamp";

/** Every limit is optional data's ceiling; `firestore/firestore.rules` enforces the same ones. */
export const ROUTINE_LIMITS = {
  nameLength: 40,
  notesLength: 500,
  stages: 10,
  stageNameLength: 40,
  exercisesPerStage: 15,
  exerciseNameLength: 40,
  exerciseNotesLength: 120,
  reps: { min: 1, max: 999 },
  restSeconds: { min: 0, max: 3_600 },
  weight: { min: 0, max: 1_000 },
} as const;

export const WEIGHT_UNITS = ["kg", "lb"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** Every field is optional, but an exercise with none of them is never kept. */
export interface Exercise {
  name?: string;
  repsMin?: number;
  /** Only present, and greater than `repsMin`, for a range like 8 - 10. */
  repsMax?: number;
  restSeconds?: number;
  weight?: number;
  /** Present exactly when `weight` is. */
  weightUnit?: WeightUnit;
  notes?: string;
}

export interface Stage {
  /** Without one, the stage is shown by its position. */
  name?: string;
  notes?: string;
  exercises: Exercise[];
}

export interface RoutineDraft {
  name: string;
  notes?: string;
  stages: Stage[];
  createdAt: number;
}

export interface Routine extends RoutineDraft {
  id: string;
}

/**
 * A stage as Firestore stores it. Rules cannot loop over a list, so its exercises are one
 * string, an exercise per line and its fields separated by tabs, which one pattern can check:
 * `name \t reps \t rest \t weight \t notes`, where reps is `8` or `8-10`, rest is seconds and
 * weight is like `62.5kg`. Text fields never hold a control character, so never a tab or line.
 */
export interface StoredStage {
  name?: string;
  notes?: string;
  exercises: string;
}

export interface StoredRoutine {
  name: string;
  notes?: string;
  stages: StoredStage[];
  createdAt: number;
}

const FIELD_SEPARATOR = "\t";
const LINE_SEPARATOR = "\n";

type Range = { readonly min: number; readonly max: number };

const hasVisibleCharacter = (text: string) => /[^\p{C}\p{Z}]/u.test(text);

/**
 * Drops half of a broken character (a lone surrogate). Firestore refuses such text with an error
 * the SDK retries forever, so a write holding it would never leave the outbox.
 */
const wellFormed = (text: string) => text.replace(/\p{Cs}/gu, "");

function intIn(value: unknown, { min, max }: Range): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Whole or with one decimal, so rules and the stored line agree on how it is written. */
function isWeight(value: unknown): value is number {
  const { min, max } = ROUTINE_LIMITS.weight;
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    Number.isInteger(Math.round(value * 10)) &&
    Math.round(value * 10) / 10 === value
  );
}

/** Text on one line: control characters become spaces. Undefined when blank or too long. */
function singleLine(raw: unknown, maxLength: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = wellFormed(raw)
    .replace(/\p{Cc}/gu, " ")
    .trim();
  return hasVisibleCharacter(text) && text.length <= maxLength ? text : undefined;
}

/** Text that may span lines; any other control character becomes a space. */
function multiLine(raw: unknown, maxLength: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = wellFormed(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n]/gu, " ")
    .trim();
  return hasVisibleCharacter(text) && text.length <= maxLength ? text : undefined;
}

export function normalizeRoutineName(raw: string): string | null {
  return singleLine(raw, ROUTINE_LIMITS.nameLength) ?? null;
}

/** Reads what the user typed for reps; null when it is not empty, one number or a range. */
export function parseRepsInput(text: string): Pick<Exercise, "repsMin" | "repsMax"> | null {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  const match = /^(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?$/.exec(trimmed);
  if (!match) return null;
  const repsMin = Number(match[1]);
  if (!intIn(repsMin, ROUTINE_LIMITS.reps)) return null;
  if (match[2] === undefined) return { repsMin };
  const repsMax = Number(match[2]);
  if (!intIn(repsMax, ROUTINE_LIMITS.reps) || repsMax < repsMin) return null;
  return repsMax === repsMin ? { repsMin } : { repsMin, repsMax };
}

export function formatReps({ repsMin, repsMax }: Pick<Exercise, "repsMin" | "repsMax">): string {
  if (repsMin === undefined) return "";
  return repsMax === undefined ? String(repsMin) : `${repsMin} - ${repsMax}`;
}

/** Reads a rest like 90, 90'', 90s or 1:30 as seconds; undefined when empty, null when invalid. */
export function parseRestInput(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  const plain = /^(\d{1,5})\s*(?:''|'|"|″|s)?$/.exec(trimmed);
  const seconds = clock
    ? Number(clock[1]) * 60 + Number(clock[2])
    : plain
      ? Number(plain[1])
      : null;
  return seconds !== null && intIn(seconds, ROUTINE_LIMITS.restSeconds) ? seconds : null;
}

export function formatRest(seconds: number): string {
  return `${seconds}''`;
}

/** Reads a weight like 60, 62.5 or 62,5; undefined when empty, null when invalid. */
export function parseWeightInput(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const match = /^(\d{1,4})(?:[.,](\d))?$/.exec(trimmed);
  if (!match) return null;
  const weight = Number(`${match[1]}.${match[2] ?? "0"}`);
  return isWeight(weight) ? weight : null;
}

/** Keeps only valid fields of untrusted data; null when none is left. */
export function sanitizeExercise(raw: unknown): Exercise | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const exercise: Exercise = {};
  const name = singleLine(source.name, ROUTINE_LIMITS.exerciseNameLength);
  if (name !== undefined) exercise.name = name;
  if (intIn(source.repsMin, ROUTINE_LIMITS.reps)) {
    exercise.repsMin = source.repsMin;
    if (intIn(source.repsMax, ROUTINE_LIMITS.reps) && source.repsMax > source.repsMin) {
      exercise.repsMax = source.repsMax;
    }
  }
  if (intIn(source.restSeconds, ROUTINE_LIMITS.restSeconds)) {
    exercise.restSeconds = source.restSeconds;
  }
  if (isWeight(source.weight)) {
    exercise.weight = source.weight;
    exercise.weightUnit = source.weightUnit === "lb" ? "lb" : "kg";
  }
  const notes = singleLine(source.notes, ROUTINE_LIMITS.exerciseNotesLength);
  if (notes !== undefined) exercise.notes = notes;
  return Object.keys(exercise).length > 0 ? exercise : null;
}

function exerciseFromLine(line: string): Exercise | null {
  const fields = line.split(FIELD_SEPARATOR);
  if (fields.length !== 5) return null;
  const [name, reps, rest, weight, notes] = fields as [string, string, string, string, string];
  const parsedReps = /^\d+(-\d+)?$/.test(reps) ? parseRepsInput(reps) : {};
  const parsedRest = /^\d+$/.test(rest) ? parseRestInput(rest) : undefined;
  const parsedWeight = /^(\d+(?:\.\d)?)(kg|lb)$/.exec(weight);
  return sanitizeExercise({
    name,
    ...parsedReps,
    restSeconds: parsedRest,
    weight: parsedWeight ? Number(parsedWeight[1]) : undefined,
    weightUnit: parsedWeight?.[2],
    notes,
  });
}

function exerciseToLine(exercise: Exercise): string {
  const reps =
    exercise.repsMin === undefined
      ? ""
      : exercise.repsMax === undefined
        ? String(exercise.repsMin)
        : `${exercise.repsMin}-${exercise.repsMax}`;
  const weight =
    exercise.weight === undefined ? "" : `${exercise.weight}${exercise.weightUnit ?? "kg"}`;
  return [
    exercise.name ?? "",
    reps,
    exercise.restSeconds === undefined ? "" : String(exercise.restSeconds),
    weight,
    exercise.notes ?? "",
  ].join(FIELD_SEPARATOR);
}

/** Reads a stage in the app's shape or the stored one; null when nothing in it is valid. */
function sanitizeStage(raw: unknown): Stage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const list: unknown[] = Array.isArray(source.exercises)
    ? source.exercises
    : typeof source.exercises === "string"
      ? source.exercises.split(LINE_SEPARATOR)
      : [];
  const exercises = list
    .flatMap(
      (item) => (typeof item === "string" ? exerciseFromLine(item) : sanitizeExercise(item)) ?? [],
    )
    .slice(0, ROUTINE_LIMITS.exercisesPerStage);
  const stage: Stage = { exercises };
  const name = singleLine(source.name, ROUTINE_LIMITS.stageNameLength);
  if (name !== undefined) stage.name = name;
  const notes = multiLine(source.notes, ROUTINE_LIMITS.notesLength);
  if (notes !== undefined) stage.notes = notes;
  return name !== undefined || notes !== undefined || exercises.length > 0 ? stage : null;
}

function sanitizeRoutine(raw: unknown): RoutineDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const name = singleLine(source.name, ROUTINE_LIMITS.nameLength);
  if (name === undefined || !isTimestamp(source.createdAt)) return null;
  const stages = Array.isArray(source.stages)
    ? source.stages.flatMap((stage) => sanitizeStage(stage) ?? []).slice(0, ROUTINE_LIMITS.stages)
    : [];
  const routine: RoutineDraft = { name, stages, createdAt: source.createdAt };
  const notes = multiLine(source.notes, ROUTINE_LIMITS.notesLength);
  if (notes !== undefined) routine.notes = notes;
  return routine;
}

/** Reads a routine from untrusted data, stored or as the app keeps it, or null when unusable. */
export function parseRoutine(id: string, raw: unknown): Routine | null {
  const routine = sanitizeRoutine(raw);
  return routine ? { id, ...routine } : null;
}

/** The routine to write to Firestore, without empty fields, exercises or stages. */
export function toStoredRoutine(draft: RoutineDraft): StoredRoutine {
  const routine = sanitizeRoutine(draft);
  if (!routine) throw new Error("A routine needs a name and a creation time");
  const stored: StoredRoutine = {
    name: routine.name,
    createdAt: routine.createdAt,
    stages: routine.stages.map(({ name, notes, exercises }) => ({
      ...(name === undefined ? {} : { name }),
      ...(notes === undefined ? {} : { notes }),
      exercises: exercises.map(exerciseToLine).join(LINE_SEPARATOR),
    })),
  };
  if (routine.notes !== undefined) stored.notes = routine.notes;
  return stored;
}
