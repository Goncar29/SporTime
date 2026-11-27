// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { ROUTINE_LIMITS, toStoredRoutine, type RoutineDraft } from "../../routines/domain/routine";
import { receivedRoutine } from "./receivedCopy";
import { buildSharedCopy, type SenderClaims, type SharedCopy } from "./sharedCopy";

const L = ROUTINE_LIMITS;

const alice: SenderClaims = {
  uid: "alice",
  email: "Alice@Example.com",
  emailVerified: true,
  name: "Alice Liddell",
  picture: "https://lh3.googleusercontent.com/a/alice=s96-c",
};

const piernas: RoutineDraft = {
  name: "Piernas",
  notes: "Calentar bien.\nRodillas primero.",
  createdAt: 1,
  stages: [
    {
      name: "Bloque A",
      notes: "Sin prisa.",
      exercises: [
        {
          name: "Sentadilla",
          repsMin: 8,
          repsMax: 10,
          restSeconds: 90,
          weight: 62.5,
          weightUnit: "kg",
          notes: "Pausa abajo",
          link: "https://www.youtube.com/watch?v=abc&t=1s",
        },
        { repsMin: 12 },
      ],
    },
    { name: "Solo el nombre", exercises: [] },
  ],
};

const SENT_AT = 1_750_000_000_000;

function copyOf(routine: RoutineDraft = piernas, sender: SenderClaims = alice): SharedCopy {
  const result = buildSharedCopy(routine, sender);
  if (!("copy" in result)) throw new Error(JSON.stringify(result.problems));
  return result.copy;
}

/** A copy as the inbox adapter hands it over: the server's time already in milliseconds. */
const inboxData = (copy: SharedCopy = copyOf(), changes: Record<string, unknown> = {}) => ({
  ...copy,
  sentAt: SENT_AT,
  ...changes,
});

describe("receivedRoutine (T26, S12)", () => {
  it("makes the copy the recipient's own routine, under the copy's id", () => {
    const copy = copyOf();
    const routine = receivedRoutine("copy-1", inboxData(copy));
    expect(routine).toEqual({
      id: "copy-1",
      name: "Piernas",
      notes: "Calentar bien.\nRodillas primero.",
      createdAt: SENT_AT,
      stages: [
        {
          name: "Bloque A",
          notes: "Sin prisa.",
          exercises: [
            {
              name: "Sentadilla",
              repsMin: 8,
              repsMax: 10,
              restSeconds: 90,
              weight: 62.5,
              weightUnit: "kg",
              notes: "Pausa abajo",
              link: "https://www.youtube.com/watch?v=abc&t=1s",
            },
            { repsMin: 12 },
          ],
        },
        { name: "Solo el nombre", exercises: [] },
      ],
      receivedFrom: { uid: "alice", name: "Alice Liddell", email: "Alice@Example.com" },
    });
  });

  it("stores exactly what was sent, with the sender kept as data and no photo", () => {
    const copy = copyOf();
    const { id: _id, ...draft } = receivedRoutine("copy-1", inboxData(copy))!;
    expect(toStoredRoutine(draft)).toEqual({
      name: copy.name,
      notes: copy.notes,
      stages: copy.stages,
      createdAt: SENT_AT,
      receivedFrom: { uid: "alice", name: "Alice Liddell", email: "Alice@Example.com" },
    });
  });

  it("keeps the sender's uid, which the inbox rules bound to who wrote the copy", () => {
    const uid = "u".repeat(L.senderUidLength);
    expect(receivedRoutine("c", inboxData(copyOf(), { fromUid: uid }))?.receivedFrom?.uid).toBe(
      uid,
    );
  });

  it("dates the routine when it was sent, so receiving it again writes the same document", () => {
    const copy = copyOf();
    expect(receivedRoutine("c", inboxData(copy))).toEqual(receivedRoutine("c", inboxData(copy)));
    expect(receivedRoutine("c", inboxData(copy))?.createdAt).toBe(SENT_AT);
  });

  it("keeps an empty sender name, and a copy without notes or photo", () => {
    const { notes: _notes, ...plain } = piernas;
    const copy = copyOf(plain, { ...alice, name: undefined, picture: undefined });
    const routine = receivedRoutine("c", inboxData(copy));
    expect(routine?.receivedFrom).toEqual({ uid: "alice", name: "", email: "Alice@Example.com" });
    expect(routine).not.toHaveProperty("notes");
  });

  it("receives the largest routine a contact can send", () => {
    const largest: RoutineDraft = {
      name: "a".repeat(L.nameLength),
      notes: "n".repeat(L.notesLength),
      createdAt: 1,
      stages: Array.from({ length: L.stages }, () => ({
        name: "b".repeat(L.stageNameLength),
        notes: "m".repeat(L.notesLength),
        exercises: Array.from({ length: L.exercisesPerStage }, () => ({
          name: "c".repeat(L.exerciseNameLength),
          repsMin: 998,
          repsMax: 999,
          restSeconds: 3600,
          weight: 999.5,
          weightUnit: "lb" as const,
          notes: "d".repeat(L.exerciseNotesLength),
          link: `https://x.com/${"e".repeat(L.linkLength - 14)}`,
        })),
      })),
    };
    const copy = copyOf(largest, { ...alice, name: "N".repeat(100) });
    const routine = receivedRoutine("c", inboxData(copy));
    expect(routine).not.toBeNull();
    const { id: _id, ...draft } = routine!;
    expect(toStoredRoutine(draft).stages).toEqual(copy.stages);
  });

  it("refuses data that is not a copy", () => {
    for (const data of [null, undefined, "copy", 3, [], {}]) {
      expect(receivedRoutine("c", data)).toBeNull();
    }
    expect(receivedRoutine("", inboxData())).toBeNull();
  });

  it("refuses a copy with a field it does not know, as from a newer version", () => {
    expect(receivedRoutine("c", inboxData(copyOf(), { version: 2 }))).toBeNull();
    expect(receivedRoutine("c", inboxData(copyOf(), { createdAt: 5 }))).toBeNull();
  });

  it("refuses a copy missing a required field", () => {
    for (const key of ["fromUid", "fromEmail", "fromName", "sentAt", "name", "stages"]) {
      const data: Record<string, unknown> = inboxData();
      delete data[key];
      expect(receivedRoutine("c", data), key).toBeNull();
    }
  });

  it("refuses a sending time that is not milliseconds", () => {
    for (const sentAt of [null, "2025-01-01", { seconds: 1, nanoseconds: 0 }, -1, 1.5, NaN]) {
      expect(
        receivedRoutine("c", inboxData(copyOf(), { sentAt })),
        JSON.stringify(sentAt),
      ).toBeNull();
    }
  });

  it("refuses a sender the recipient's own routine rules would refuse", () => {
    for (const changes of [
      { fromEmail: "" },
      { fromEmail: "no-at-sign" },
      { fromEmail: "a b@example.com" },
      { fromEmail: "a@b@c" },
      { fromEmail: "a/b@example.com" },
      { fromEmail: `${"a".repeat(250)}@b.co` },
      { fromEmail: 7 },
      { fromName: "Ali\u0007ce" },
      { fromName: "Line\nbreak" },
      { fromName: "N".repeat(101) },
      { fromName: "broken \uD800 half" },
      { fromName: null },
      { fromUid: "" },
      { fromUid: 1 },
      { fromUid: "a/b" },
      { fromUid: "a\u0007b" },
      { fromUid: "u".repeat(L.senderUidLength + 1) },
      { fromPhoto: 3 },
    ]) {
      expect(
        receivedRoutine("c", inboxData(copyOf(), changes)),
        JSON.stringify(changes),
      ).toBeNull();
    }
  });

  it("refuses routine content the inbox rules refuse, instead of dropping part of it", () => {
    const copy = copyOf();
    const stage = copy.stages[0]!;
    for (const changes of [
      { name: "" },
      { name: "   " },
      { name: "\u200b" },
      { name: "n".repeat(L.nameLength + 1) },
      { name: 5 },
      { notes: " " },
      { notes: 5 },
      { stages: "none" },
      { stages: [null] },
      { stages: [{ exercises: "" }] },
      { stages: [{ ...stage, extra: 1 }] },
      { stages: [{ ...stage, exercises: 5 }] },
      { stages: [{ ...stage, name: 5 }] },
      { stages: [{ ...stage, exercises: "\t10-8\t\t\t\t" }] },
      { stages: [{ ...stage, exercises: "\t\t\t\t\t" }] },
      { stages: [{ ...stage, exercises: "a\t\t\t\t\t\n" }] },
      { stages: [{ ...stage, exercises: "a\t\t\t\t" }] },
      { stages: [{ ...stage, exercises: "a\t\t\t\t\thttps://192.168.0.1" }] },
      { stages: [{ ...stage, exercises: "a\t\t\t\t\thttp://x.com" }] },
      { stages: Array.from({ length: L.stages + 1 }, () => stage) },
    ]) {
      expect(receivedRoutine("c", inboxData(copy, changes)), JSON.stringify(changes)).toBeNull();
    }
  });
});

describe("known advisory L64 A4", () => {
  it("refuses a sender name of 60 emoji: 60 code points, but 120 UTF-16 units", () => {
    const fromName = "💪".repeat(60);
    expect(fromName.length).toBe(120);
    expect(receivedRoutine("c", inboxData(copyOf(), { fromName }))).toBeNull();
  });
});
