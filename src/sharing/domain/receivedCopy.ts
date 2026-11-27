import { isGooglePhoto } from "../../directory/domain/directory";
import {
  isSenderEmail,
  isSenderName,
  isSenderUid,
  parseRoutine,
  sanitizeSender,
  type Routine,
  type Sender,
  type StoredStage,
} from "../../routines/domain/routine";
import { isTimestamp } from "../../shared/domain/timestamp";
import { storedCopyProblems } from "./sharedCopy";

/**
 * Receiving a copy a contact sent (T26, S12): it becomes one of the recipient's own routines,
 * which remembers who sent it (`receivedFrom`: uid, name, email and their Google photo, if any)
 * and nothing else about them. The uid is trustworthy: the inbox rules only accept a copy whose
 * fromUid is its writer's.
 */

/** Every field a copy may hold (see SharedCopy); `sentAt` is the server's time in milliseconds. */
const REQUIRED = ["fromUid", "fromEmail", "fromName", "sentAt", "name", "stages"] as const;
const OPTIONAL = ["fromPhoto", "notes"] as const;
const KNOWN = new Set<string>([...REQUIRED, ...OPTIONAL]);
const STAGE_KEYS = new Set(["name", "notes", "exercises"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stage in the stored shape, with nothing else in it; its content is checked afterwards. */
function isStoredStage(value: unknown): value is StoredStage {
  return (
    isObject(value) &&
    Object.keys(value).every((key) => STAGE_KEYS.has(key)) &&
    typeof value.exercises === "string" &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.notes === undefined || typeof value.notes === "string")
  );
}

/**
 * The routine a copy in the inbox becomes, under the copy's own id, so receiving the same copy
 * twice writes the same document. Dated when it was sent (`sentAt`), so every attempt writes the
 * same data and it sits among the user's routines by that date. Null when the copy holds anything
 * the inbox rules would have refused, a field this version does not know, or a sender the
 * recipient's own routine rules would refuse: such a copy is left where it is, never half-kept.
 */
export function receivedRoutine(copyId: string, data: unknown): Routine | null {
  if (copyId === "" || !isObject(data)) return null;
  if (!Object.keys(data).every((key) => KNOWN.has(key))) return null;
  if (!REQUIRED.every((key) => key in data)) return null;
  const { fromUid, fromEmail, fromName, fromPhoto, sentAt, name, notes, stages } = data;
  if (!isSenderUid(fromUid)) return null;
  // The inbox rules take only a Google photo (T29 W3).
  if (fromPhoto !== undefined && (typeof fromPhoto !== "string" || !isGooglePhoto(fromPhoto))) {
    return null;
  }
  if (!isSenderEmail(fromEmail) || !isSenderName(fromName)) return null;
  // The rules refuse a creation time before 1970, which isTimestamp allows.
  if (!isTimestamp(sentAt) || sentAt < 0) return null;
  if (typeof name !== "string" || (notes !== undefined && typeof notes !== "string")) return null;
  if (!Array.isArray(stages) || !stages.every(isStoredStage)) return null;
  const content = { name, ...(notes === undefined ? {} : { notes }), stages };
  if (storedCopyProblems(content).length > 0) return null;
  return parseRoutine(copyId, {
    ...content,
    createdAt: sentAt,
    receivedFrom: {
      uid: fromUid,
      name: fromName,
      email: fromEmail,
      ...(fromPhoto === undefined ? {} : { photo: fromPhoto }),
    },
  });
}

/**
 * Who sent a copy, read from whatever the copy holds, for one this app cannot open (T29 W5): a
 * newer version's, or one the inbox rules accept but the app does not (a link it will not open).
 * The user is shown who sent it, to delete it or block them. Null without a usable uid (the account
 * a block names) or email (the one thing that tells who they are): such a copy cannot be shown by
 * its sender. A name or photo that cannot be kept is left out, as on a received routine.
 */
export function copySender(data: unknown): Sender | null {
  if (!isObject(data)) return null;
  const { fromUid: uid, fromEmail: email, fromName: name, fromPhoto: photo } = data;
  return sanitizeSender({ uid, name, email, photo }) ?? null;
}
