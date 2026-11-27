import { DIRECTORY_LIMITS, isGooglePhoto } from "../../directory/domain/directory";
import {
  ROUTINE_LIMITS,
  exerciseFields,
  isSenderEmail,
  normalizeLink,
  type RoutineDraft,
  type StoredStage,
} from "../../routines/domain/routine";

/**
 * A copy of a routine sent to a contact (S12), as `users/{recipient}/inbox/{copyId}` holds it.
 * The rules for that path (isInboxCopy in firestore/firestore.rules) check it more strictly than
 * one's own routines, so the recipient's app never drops part of it; this module checks the same
 * things first, so a copy the rules would refuse is never written, and says what to fix.
 */

/** What the sender's Google sign-in says about them: the ID token's claims, as they are. */
export interface SenderClaims {
  uid: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/** Everything written but `sentAt`, which only the server's clock may set. */
export interface SharedCopy {
  fromUid: string;
  /** The sign-in's email, exactly; the one identity a recipient can rely on. */
  fromEmail: string;
  /** The sign-in's name, exactly, or empty when it has none. */
  fromName: string;
  /** The sign-in's picture, only when it is a Google photo (isGooglePhoto). */
  fromPhoto?: string;
  name: string;
  notes?: string;
  stages: StoredStage[];
}

export type ExerciseField = "name" | "reps" | "rest" | "weight" | "notes" | "link" | "empty";

/** What keeps a copy from being sent, by where it is; stage and exercise count from 1. */
export type ShareProblem =
  /** The Google name is too long or holds characters the rules refuse. */
  | { kind: "senderName" }
  /**
   * The sign-in has no verified email, or one a recipient could not keep: longer than
   * `senderEmailLength` or with a control character (T29 W4).
   */
  | { kind: "senderEmail" }
  | { kind: "routineName" }
  | { kind: "routineNotes" }
  | { kind: "tooManyStages" }
  | { kind: "stageName"; stage: number }
  | { kind: "stageNotes"; stage: number }
  | { kind: "emptyStage"; stage: number }
  | { kind: "tooManyExercises"; stage: number }
  | {
      kind: "exercise";
      field: ExerciseField;
      stage: number;
      exercise: number;
      /** Present only when the name itself can be shown and sent. */
      exerciseName?: string;
    };

export type SharedCopyResult = { copy: SharedCopy } | { problems: ShareProblem[] };

/**
 * The first character of every text in a copy: something visible. Besides \p{C} and \p{Z}, the
 * characters the rules engine's older Unicode tables do not count as invisible (the L56 list),
 * kept equal to the class in isSharedExercises.
 */
const VISIBLE = String.raw`[^\p{C}\p{Z}\u061C\u08E2\u0890-\u0891\u{110BD}\u{110CD}\u{13430}-\u{1345F}\u{1BCA0}-\u{1BCA3}\u2060-\u206F\uFFF0-\uFFFF\u{E0000}-\u{E0FFF}]`;

/** Half of a broken character: Firestore refuses any text holding one. */
const BROKEN = /\p{Cs}/u;

/** One line: something visible first, no control character, at most `max` characters. */
const lineOf = (max: number) => new RegExp(String.raw`^${VISIBLE}[^\p{Cc}]{0,${max - 1}}$`, "u");
/** Like `lineOf`, but line breaks are allowed after the first character. */
const notesOf = (max: number) =>
  new RegExp(String.raw`^${VISIBLE}[^\x00-\x09\x0B-\x1F\x7F-\x9F]{0,${max - 1}}$`, "u");

/**
 * Checks text against a pattern that counts characters as the rules do (code points) and against
 * the app's own limit, which counts UTF-16 units: the recipient's app drops longer text.
 */
const fits = (pattern: RegExp, max: number) => (text: string) =>
  text.length <= max && !BROKEN.test(text) && pattern.test(text);

const L = ROUTINE_LIMITS;
const isRoutineName = fits(lineOf(L.nameLength), L.nameLength);
const isNotes = fits(notesOf(L.notesLength), L.notesLength);
const isStageName = fits(lineOf(L.stageNameLength), L.stageNameLength);
const isExerciseName = fits(lineOf(L.exerciseNameLength), L.exerciseNameLength);
const isExerciseNotes = fits(lineOf(L.exerciseNotesLength), L.exerciseNotesLength);

const REPS = /^(?:([1-9]\d{0,2})(?:-([1-9]\d{0,2}))?)?$/;
const REST = /^(?:3600|3[0-5]\d\d|[12]\d{3}|[1-9]\d{0,2}|0)?$/;
const WEIGHT = /^(?:(?:1000(?:\.0)?|(?:[1-9]\d{0,2}|0)(?:\.\d)?)(?:kg|lb))?$/;

/**
 * A link as the inbox rules take it: an ASCII host of letters, digits, - and . with at least one
 * dot, ending in a top-level name of 2 to 63 letters or xn-- and letters, digits or -, then maybe
 * a dot, a port of 0 to 65535 (T29 W5) and a path with nothing invisible.
 */
const SHARED_LINK =
  /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]{0,226}\.([A-Za-z]{2,63}|[xX][nN]--[A-Za-z0-9-]{1,59})\.?(?::(?:6553[0-5]|655[0-2]\d|65[0-4]\d\d|6[0-4]\d{3}|[0-5]\d{4}|\d{1,4}))?(?:[/?#\\][^\p{C}\p{Z}]{0,291})?$/u;
/** The top-level names the rules refuse even though they are letters: local network names. */
const LOCAL_TOP_LEVEL = /^(?:localhost|local|lan|internal|arpa)$/i;

/** The host as typed, and what follows it. */
const LINK_PARTS = /^https:\/\/([^:/?#\\]*)([\s\S]*)$/u;

function hostOf(link: string): string | null {
  try {
    return new URL(link).hostname;
  } catch {
    return null;
  }
}

/**
 * The link as a copy holds it: an international host turned into its ASCII (punycode) form, the
 * rest as typed, like https://bücher.de/libro to https://xn--bcher-kva.de/libro. Null when the
 * result is not a link the inbox rules accept and the recipient's app opens, or when it would
 * open another host than the original.
 */
export function shareableLink(link: string): string | null {
  const parts = LINK_PARTS.exec(link);
  if (!parts) return null;
  const [, host = "", rest = ""] = parts;
  let ascii = host;
  if (/[^\p{ASCII}]/u.test(host)) {
    // Credentials, escapes and brackets are never converted: the URL parser would hide them.
    if (/[@%[\]\s]/u.test(host)) return null;
    const parsed = hostOf(`https://${host}/`);
    if (parsed === null) return null;
    ascii = parsed;
  }
  const shared = `https://${ascii}${rest}`;
  const topLevel = SHARED_LINK.exec(shared)?.[1];
  if (topLevel === undefined || LOCAL_TOP_LEVEL.test(topLevel)) return null;
  // As the recipient's app reads it: a safe link to a named site, kept as it is.
  if (normalizeLink(shared) !== shared) return null;
  const original = hostOf(link);
  return original !== null && original === hostOf(shared) ? shared : null;
}

/** The six fields of a stored exercise line, checked as the inbox rules check them. */
function lineFieldProblems(fields: readonly string[]): ExerciseField[] {
  const [name = "", reps = "", rest = "", weight = "", notes = "", link = ""] = fields;
  if (fields.every((field) => field === "")) return ["empty"];
  const problems: ExerciseField[] = [];
  if (name !== "" && !isExerciseName(name)) problems.push("name");
  const range = REPS.exec(reps);
  if (!range || (range[2] !== undefined && Number(range[2]) <= Number(range[1]))) {
    problems.push("reps");
  }
  if (!REST.test(rest)) problems.push("rest");
  if (!WEIGHT.test(weight)) problems.push("weight");
  if (notes !== "" && !isExerciseNotes(notes)) problems.push("notes");
  if (link !== "" && shareableLink(link) !== link) problems.push("link");
  return problems;
}

/**
 * Builds the copy of `routine` that `sender` may write to a contact's inbox, or lists everything
 * that keeps it from being sent. Nothing is dropped or trimmed: every text, exercise and stage is
 * sent as it is, or named here. Only a link's international host is converted, in the copy only.
 */
export function buildSharedCopy(routine: RoutineDraft, sender: SenderClaims): SharedCopyResult {
  const problems: ShareProblem[] = [];
  const fromName = sender.name ?? "";
  if (
    fromName.length > DIRECTORY_LIMITS.nameLength ||
    BROKEN.test(fromName) ||
    !/^[^\p{Cc}]*$/u.test(fromName)
  ) {
    problems.push({ kind: "senderName" });
  }
  // The rules take any email of a verified sign-in; the recipient keeps one of the shape and length
  // isSenderEmail accepts, so another is refused here, before sending, never left unreceivable.
  if (!sender.emailVerified || !isSenderEmail(sender.email)) problems.push({ kind: "senderEmail" });

  if (!isRoutineName(routine.name)) problems.push({ kind: "routineName" });
  if (routine.notes !== undefined && !isNotes(routine.notes)) {
    problems.push({ kind: "routineNotes" });
  }
  if (routine.stages.length > L.stages) problems.push({ kind: "tooManyStages" });

  const stages = routine.stages.map((source, index): StoredStage => {
    const stage = index + 1;
    if (source.name !== undefined && !isStageName(source.name)) {
      problems.push({ kind: "stageName", stage });
    }
    if (source.notes !== undefined && !isNotes(source.notes)) {
      problems.push({ kind: "stageNotes", stage });
    }
    if (source.name === undefined && source.notes === undefined && source.exercises.length === 0) {
      problems.push({ kind: "emptyStage", stage });
    }
    if (source.exercises.length > L.exercisesPerStage) {
      problems.push({ kind: "tooManyExercises", stage });
    }
    const lines = source.exercises.map((exercise, position) => {
      const fields = exerciseFields(exercise);
      const link = fields[5] ?? "";
      const shared = link === "" ? "" : shareableLink(link);
      // A link that cannot be shared is named below, checked as it is.
      if (shared !== null) fields[5] = shared;
      const name = fields[0] ?? "";
      for (const field of lineFieldProblems(fields)) {
        problems.push({
          kind: "exercise",
          field,
          stage,
          exercise: position + 1,
          ...(name !== "" && isExerciseName(name) ? { exerciseName: name } : {}),
        });
      }
      return fields.join("\t");
    });
    return {
      ...(source.name === undefined ? {} : { name: source.name }),
      ...(source.notes === undefined ? {} : { notes: source.notes }),
      exercises: lines.join("\n"),
    };
  });

  if (problems.length > 0) return { problems };
  const copy: SharedCopy = {
    fromUid: sender.uid,
    fromEmail: sender.email ?? "",
    fromName,
    ...(sender.picture !== undefined && isGooglePhoto(sender.picture)
      ? { fromPhoto: sender.picture }
      : {}),
    name: routine.name,
    ...(routine.notes === undefined ? {} : { notes: routine.notes }),
    stages,
  };
  return { copy };
}

/**
 * Checks the routine part of a copy as stored (one string of lines per stage), as the inbox
 * rules do; the same checks `buildSharedCopy` runs. Used when receiving a copy (receivedRoutine),
 * and by the tests that hold the app and the rules in agreement.
 */
export function storedCopyProblems(content: {
  name: string;
  notes?: string;
  stages: readonly StoredStage[];
}): ShareProblem[] {
  const problems: ShareProblem[] = [];
  if (!isRoutineName(content.name)) problems.push({ kind: "routineName" });
  if (content.notes !== undefined && !isNotes(content.notes)) {
    problems.push({ kind: "routineNotes" });
  }
  if (content.stages.length > L.stages) problems.push({ kind: "tooManyStages" });
  content.stages.forEach((source, index) => {
    const stage = index + 1;
    if (source.name !== undefined && !isStageName(source.name)) {
      problems.push({ kind: "stageName", stage });
    }
    if (source.notes !== undefined && !isNotes(source.notes)) {
      problems.push({ kind: "stageNotes", stage });
    }
    if (source.exercises === "") {
      if (source.name === undefined && source.notes === undefined) {
        problems.push({ kind: "emptyStage", stage });
      }
      return;
    }
    const lines = source.exercises.split("\n");
    if (lines.length > L.exercisesPerStage) problems.push({ kind: "tooManyExercises", stage });
    lines.forEach((line, position) => {
      const fields = line.split("\t");
      const where = { kind: "exercise" as const, stage, exercise: position + 1 };
      // A line of another shape holds a tab or line break in a text, or misses a field.
      if (fields.length !== 6) {
        problems.push({
          ...where,
          field: fields.every((field) => field === "") ? "empty" : "name",
        });
        return;
      }
      for (const field of lineFieldProblems(fields)) problems.push({ ...where, field });
    });
  });
  return problems;
}
