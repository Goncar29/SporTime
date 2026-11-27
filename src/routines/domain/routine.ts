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
  linkLength: 300,
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
  /**
   * An https link, checked by `normalizeLink`, opened from the routine's view. A routine stored
   * before links to the local network were refused may still hold one (`isLocalLink`): it is
   * kept so the editor can show it to be fixed, but it is never opened nor stored again.
   */
  link?: string;
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
 * `name \t reps \t rest \t weight \t notes \t link`, where reps is `8` or `8-10`, rest is seconds,
 * weight is like `62.5kg` and link is empty or an https link. Text fields never hold a control
 * character, so never a tab or line. Lines written before links, with five fields, still read.
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

/**
 * The link part after `https://`: a host without `@` (so no user or password), then optionally
 * a path, query or fragment. No space, separator or invisible character anywhere. Only the
 * lowercase scheme is accepted, as typed, so what is stored, checked by the rules and opened
 * is the same text.
 */
const SAFE_LINK = /^https:\/\/[^@/?#\\\p{C}\p{Z}]+(?:[/?#\\][^\p{C}\p{Z}]*)?$/u;

/** The characters a browser reads as the dot between two parts of a host name. */
const DOT = String.raw`[.\u3002\uFF0E\uFF61]`;

/**
 * A link, as typed, whose host is not a named internet site: bracketed (an IPv6 address), ending
 * in a number or a 0x number (the browser reads it as an IPv4 address, or not at all), localhost
 * or a local network suffix, or a single name with no dot. `firestore/firestore.rules` refuses
 * the same text with the same pattern, so the app never saves a link the rules refuse.
 */
const LOCAL_HOST_AS_TYPED = new RegExp(
  String.raw`^https://(?:\[.*|(?:[^:/?#\\]*${DOT})?(?:[0-9]+|0x[0-9a-f]*|localhost|local|lan|internal|home${DOT}arpa)${DOT}?|[^.\u3002\uFF0E\uFF61:/?#\\]+${DOT}?)(?:[:/?#\\].*)?$`,
  "iu",
);

/** The suffixes that name a machine on a local network, never a site on the internet. */
const LOCAL_SUFFIXES = ["localhost", "local", "lan", "internal", "home.arpa"];

/**
 * The host as the browser reads it, after it turns other number forms into an IPv4 address and
 * other dots and letters into plain ones (https://3232235521 opens 192.168.0.1).
 */
function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "");
  return (
    host.startsWith("[") ||
    /(?:^|\.)[0-9]+$/.test(host) ||
    !host.includes(".") ||
    LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  );
}

type LinkReading =
  | { kind: "empty" }
  | { kind: "unsafe" }
  | { kind: "local"; text: string }
  | { kind: "site"; text: string };

function readLink(raw: string): LinkReading {
  const text = wellFormed(raw).trim();
  if (text === "") return { kind: "empty" };
  if (text.length > ROUTINE_LIMITS.linkLength || !SAFE_LINK.test(text)) return { kind: "unsafe" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: "unsafe" };
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return { kind: "unsafe" };
  }
  // Checked before the visible name, so a bracketed IPv6 address is reported as local.
  if (LOCAL_HOST_AS_TYPED.test(text) || isLocalHost(url.hostname)) return { kind: "local", text };
  return namesVisibleSite(url.hostname.replace(/^www\./, ""))
    ? { kind: "site", text }
    : { kind: "unsafe" };
}

/**
 * Reads a typed link: undefined when empty, null when it is not a safe https link to a named
 * internet site (a link to the local network or an IP address is refused too, see `isLocalLink`).
 */
export function normalizeLink(raw: string): string | null | undefined {
  const link = readLink(raw);
  return link.kind === "empty" ? undefined : link.kind === "site" ? link.text : null;
}

/**
 * True for a link that would be a safe https link but points to the local network or an IP
 * address: localhost, an IPv4 or IPv6 address in any form, a name with no dot, or a name ending
 * in .local, .lan, .internal or .home.arpa. `normalizeLink` refuses it.
 */
export function isLocalLink(raw: string): boolean {
  return readLink(raw).kind === "local";
}

/**
 * True when a host can name a link's button: it starts with a letter or digit and holds no
 * Hangul filler, which the URL parser keeps but no one can see (`https://www.` would name nothing).
 */
function namesVisibleSite(host: string): boolean {
  return /^[\p{L}\p{N}]/u.test(host) && !/[\u115F\u1160\u3164\uFFA0]/u.test(host);
}

/** The site a link opens, like youtube.com, to name its button. */
export function linkHost(link: string): string {
  return new URL(link).hostname.replace(/^www\./, "");
}

/**
 * Keeps only valid fields of untrusted data; null when none is left. A link to the local network
 * is kept unless `forStorage`: a routine read keeps it so the editor asks to fix it, while what is
 * stored never holds it, because the rules refuse it.
 */
export function sanitizeExercise(raw: unknown, forStorage = false): Exercise | null {
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
  const link = typeof source.link === "string" ? readLink(source.link) : undefined;
  if (link?.kind === "site" || (link?.kind === "local" && !forStorage)) exercise.link = link.text;
  return Object.keys(exercise).length > 0 ? exercise : null;
}

function exerciseFromLine(line: string, forStorage: boolean): Exercise | null {
  const fields = line.split(FIELD_SEPARATOR);
  // Five fields: a line written before links existed.
  if (fields.length !== 5 && fields.length !== 6) return null;
  const [name, reps, rest, weight, notes, link] = fields as [
    string,
    string,
    string,
    string,
    string,
    string?,
  ];
  const parsedReps = /^\d+(-\d+)?$/.test(reps) ? parseRepsInput(reps) : {};
  const parsedRest = /^\d+$/.test(rest) ? parseRestInput(rest) : undefined;
  const parsedWeight = /^(\d+(?:\.\d)?)(kg|lb)$/.exec(weight);
  return sanitizeExercise(
    {
      name,
      ...parsedReps,
      restSeconds: parsedRest,
      weight: parsedWeight ? Number(parsedWeight[1]) : undefined,
      weightUnit: parsedWeight?.[2],
      notes,
      link,
    },
    forStorage,
  );
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
    exercise.link ?? "",
  ].join(FIELD_SEPARATOR);
}

/** Reads a stage in the app's shape or the stored one; null when nothing in it is valid. */
function sanitizeStage(raw: unknown, forStorage: boolean): Stage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const list: unknown[] = Array.isArray(source.exercises)
    ? source.exercises
    : typeof source.exercises === "string"
      ? source.exercises.split(LINE_SEPARATOR)
      : [];
  const exercises = list
    .flatMap(
      (item) =>
        (typeof item === "string"
          ? exerciseFromLine(item, forStorage)
          : sanitizeExercise(item, forStorage)) ?? [],
    )
    .slice(0, ROUTINE_LIMITS.exercisesPerStage);
  const stage: Stage = { exercises };
  const name = singleLine(source.name, ROUTINE_LIMITS.stageNameLength);
  if (name !== undefined) stage.name = name;
  const notes = multiLine(source.notes, ROUTINE_LIMITS.notesLength);
  if (notes !== undefined) stage.notes = notes;
  return name !== undefined || notes !== undefined || exercises.length > 0 ? stage : null;
}

function sanitizeRoutine(raw: unknown, forStorage: boolean): RoutineDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const name = singleLine(source.name, ROUTINE_LIMITS.nameLength);
  if (name === undefined || !isTimestamp(source.createdAt)) return null;
  const stages = Array.isArray(source.stages)
    ? source.stages
        .flatMap((stage) => sanitizeStage(stage, forStorage) ?? [])
        .slice(0, ROUTINE_LIMITS.stages)
    : [];
  const routine: RoutineDraft = { name, stages, createdAt: source.createdAt };
  const notes = multiLine(source.notes, ROUTINE_LIMITS.notesLength);
  if (notes !== undefined) routine.notes = notes;
  return routine;
}

/** Reads a routine from untrusted data, stored or as the app keeps it, or null when unusable. */
export function parseRoutine(id: string, raw: unknown): Routine | null {
  const routine = sanitizeRoutine(raw, false);
  return routine ? { id, ...routine } : null;
}

/**
 * The routine to write to Firestore, without empty fields, exercises or stages. A link to the
 * local network is left out (the editor never saves one; this keeps an older queued write from
 * being refused by the rules).
 */
export function toStoredRoutine(draft: RoutineDraft): StoredRoutine {
  const routine = sanitizeRoutine(draft, true);
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
