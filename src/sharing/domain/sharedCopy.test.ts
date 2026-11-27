// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { DIRECTORY_LIMITS } from "../../directory/domain/directory";
import { ROUTINE_LIMITS, type Exercise, type RoutineDraft } from "../../routines/domain/routine";
import { buildSharedCopy, shareableLink, type SenderClaims, type ShareProblem } from "./sharedCopy";

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
  createdAt: 1_700_000_000_000,
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
    { exercises: [{ weight: 20, weightUnit: "lb" }] },
  ],
};

const withExercise = (exercise: Exercise): RoutineDraft => ({
  ...piernas,
  stages: [{ name: "Fuerza", exercises: [{ name: "Remo", repsMin: 10 }, exercise] }],
});

function problemsOf(routine: RoutineDraft, sender: SenderClaims = alice): ShareProblem[] {
  const result = buildSharedCopy(routine, sender);
  if (!("problems" in result)) throw new Error("Expected the copy to be refused");
  return result.problems;
}

function copyOf(routine: RoutineDraft, sender: SenderClaims = alice) {
  const result = buildSharedCopy(routine, sender);
  if (!("copy" in result)) {
    throw new Error(`Expected a copy, got ${JSON.stringify(result.problems)}`);
  }
  return result.copy;
}

describe("a copy of a valid routine (T25, S12)", () => {
  it("holds the routine as stored, without createdAt, and the sender from the sign-in", () => {
    expect(copyOf(piernas)).toEqual({
      fromUid: "alice",
      fromEmail: "Alice@Example.com",
      fromName: "Alice Liddell",
      fromPhoto: "https://lh3.googleusercontent.com/a/alice=s96-c",
      name: "Piernas",
      notes: "Calentar bien.\nRodillas primero.",
      stages: [
        {
          name: "Bloque A",
          notes: "Sin prisa.",
          exercises:
            "Sentadilla\t8-10\t90\t62.5kg\tPausa abajo\thttps://www.youtube.com/watch?v=abc&t=1s\n\t12\t\t\t\t",
        },
        { exercises: "\t\t\t20lb\t\t" },
      ],
    });
  });

  it("leaves out notes, names and the photo the routine or the sign-in lack", () => {
    const copy = copyOf(
      { name: "Solo", createdAt: 1, stages: [{ name: "Una", exercises: [] }] },
      { uid: "alice", email: "a@x.com", emailVerified: true },
    );
    expect(copy).toEqual({
      fromUid: "alice",
      fromEmail: "a@x.com",
      fromName: "",
      name: "Solo",
      stages: [{ name: "Una", exercises: "" }],
    });
    expect("fromPhoto" in copy).toBe(false);
    expect("notes" in copy).toBe(false);
  });

  it("leaves out a photo that is not on googleusercontent.com, as the rules require", () => {
    const copy = copyOf(piernas, { ...alice, picture: "https://example.com/alice.png" });
    expect("fromPhoto" in copy).toBe(false);
  });

  it("never changes the routine it is built from", () => {
    const routine: RoutineDraft = structuredClone({
      ...piernas,
      stages: [{ exercises: [{ name: "Libro", link: "https://bücher.de/libro" }] }],
    });
    const before = structuredClone(routine);
    copyOf(routine);
    expect(routine).toEqual(before);
    problemsOf({ ...routine, name: "\u200bX" });
    expect(routine).toEqual(before);
  });

  it("accepts the largest routine, texts starting with an emoji, and multibyte text", () => {
    const e = "\u{1F4AA}";
    const largest: RoutineDraft = {
      name: "a".repeat(L.nameLength),
      notes: `${e} ${"n".repeat(L.notesLength - 3)}`,
      createdAt: 1,
      stages: Array.from({ length: L.stages }, () => ({
        name: e.repeat(L.stageNameLength / 2),
        notes: "m".repeat(L.notesLength),
        exercises: Array.from({ length: L.exercisesPerStage }, () => ({
          name: "c".repeat(L.exerciseNameLength),
          repsMin: L.reps.max - 1,
          repsMax: L.reps.max,
          restSeconds: L.restSeconds.max,
          weight: L.weight.max,
          weightUnit: "lb" as const,
          notes: "d".repeat(L.exerciseNotesLength),
          link: `https://x.com/${"e".repeat(L.linkLength - 14)}`,
        })),
      })),
    };
    expect(copyOf(largest).stages).toHaveLength(L.stages);
  });
});

describe("links in a copy (T25, S12, S9)", () => {
  it("converts an international host to punycode, keeping the rest as typed", () => {
    expect(shareableLink("https://bücher.de/libro")).toBe("https://xn--bcher-kva.de/libro");
    expect(shareableLink("https://bücher.de/año?q=ñ#é")).toBe("https://xn--bcher-kva.de/año?q=ñ#é");
    expect(shareableLink("https://例え.テスト/x")).toBe("https://xn--r8jz45g.xn--zckzah/x");
    expect(shareableLink("https://www.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
    expect(shareableLink("https://EXAMPLE.COM.")).toBe("https://EXAMPLE.COM.");
    expect(shareableLink("https://example.io:8443/x")).toBe("https://example.io:8443/x");
  });

  it("converts only the copy: the routine keeps its link", () => {
    const routine = withExercise({ name: "Libro", link: "https://bücher.de/libro" });
    expect(copyOf(routine).stages[0]?.exercises).toBe(
      "Remo\t10\t\t\t\t\nLibro\t\t\t\t\thttps://xn--bcher-kva.de/libro",
    );
    expect(routine.stages[0]?.exercises[1]?.link).toBe("https://bücher.de/libro");
  });

  it("refuses hosts the inbox's ASCII rules refuse, naming the exercise", () => {
    for (const link of [
      "https://x_y.com",
      "https://example.c0m",
      "https://in-addr.arpa",
      "https://x.ARPA",
      "https://example.com:123456",
      // A port above 65535, which no browser opens (T29 W5).
      "https://example.com:65536",
      "https://example.com:99999",
      "https://example.com:70000",
      "https://x.com:abc",
      "https://192.168.0.1",
      "https://router",
      "https://nas.local",
      "https://localhost",
      "https://you%2Ecom",
      "https://\uff11\uff19\uff12\uff0e\uff11\uff16\uff18\uff0e\uff10\uff0e\uff11",
      "https://x.com/a\u200bb",
      `https://x.com/${"e".repeat(L.linkLength)}`,
      `https://${"é".repeat(L.linkLength - 12)}.com`,
      "http://x.com",
      "https://user:pw@x.com",
    ]) {
      expect(shareableLink(link), link).toBeNull();
      expect(problemsOf(withExercise({ name: "Video", link })), link).toEqual([
        { kind: "exercise", field: "link", stage: 1, exercise: 2, exerciseName: "Video" },
      ]);
    }
  });

  it("names an exercise without a name by its position", () => {
    expect(problemsOf(withExercise({ repsMin: 5, link: "https://x_y.com" }))).toEqual([
      { kind: "exercise", field: "link", stage: 1, exercise: 2 },
    ]);
  });
});

describe("texts the strict rules refuse (T25, L56 A1)", () => {
  /** Characters that show nothing: format, private use, tag and the L56 list. */
  const invisible = [
    "\u200b",
    "\u200e",
    "\u200f",
    "\u202e",
    "\u00ad",
    "\ue000",
    "\u{f0000}",
    "\u{e0041}",
    "\u2066",
    "\u2069",
    "\u061c",
    "\u08e2",
    "\u0890",
    "\u{110cd}",
    "\u{13430}",
    "\u{1bca0}",
    "\u2065",
    "\u{e0080}",
    "\ufffe",
    "\ufeff",
  ];

  it("refuses a routine name or notes starting with an invisible character", () => {
    for (const mark of invisible) {
      expect(problemsOf({ ...piernas, name: `${mark}Piernas` })).toEqual([{ kind: "routineName" }]);
      expect(problemsOf({ ...piernas, notes: `${mark}Notas` })).toEqual([{ kind: "routineNotes" }]);
    }
  });

  it("refuses a stage name or notes starting with an invisible character", () => {
    for (const mark of invisible) {
      const stage = { exercises: [{ name: "Remo" }] };
      expect(
        problemsOf({ ...piernas, stages: [stage, { ...stage, name: `${mark}Etapa` }] }),
      ).toEqual([{ kind: "stageName", stage: 2 }]);
      expect(
        problemsOf({ ...piernas, stages: [stage, { ...stage, notes: `${mark}Notas` }] }),
      ).toEqual([{ kind: "stageNotes", stage: 2 }]);
    }
  });

  it("refuses an exercise name or notes starting with an invisible character", () => {
    for (const mark of invisible) {
      expect(problemsOf(withExercise({ name: `${mark}Curl` }))).toEqual([
        { kind: "exercise", field: "name", stage: 1, exercise: 2 },
      ]);
      expect(problemsOf(withExercise({ name: "Curl", notes: `${mark}lento` }))).toEqual([
        { kind: "exercise", field: "notes", stage: 1, exercise: 2, exerciseName: "Curl" },
      ]);
    }
  });

  it("refuses blank names and notes instead of dropping them", () => {
    for (const blank of ["", " ", "\u3000"]) {
      expect(problemsOf({ ...piernas, name: blank })).toEqual([{ kind: "routineName" }]);
      expect(problemsOf({ ...piernas, notes: blank })).toEqual([{ kind: "routineNotes" }]);
      expect(
        problemsOf({ ...piernas, stages: [{ name: blank, exercises: [{ repsMin: 1 }] }] }),
      ).toEqual([{ kind: "stageName", stage: 1 }]);
    }
  });

  it("refuses texts that are too long or hold control characters", () => {
    expect(problemsOf({ ...piernas, name: "a".repeat(L.nameLength + 1) })).toEqual([
      { kind: "routineName" },
    ]);
    // 21 emoji are 21 characters for the rules but 42 for the app, which would drop the routine.
    expect(problemsOf({ ...piernas, name: "\u{1F4AA}".repeat(21) })).toEqual([
      { kind: "routineName" },
    ]);
    expect(problemsOf({ ...piernas, notes: "n".repeat(L.notesLength + 1) })).toEqual([
      { kind: "routineNotes" },
    ]);
    expect(problemsOf({ ...piernas, name: "Pier\tnas" })).toEqual([{ kind: "routineName" }]);
    expect(problemsOf({ ...piernas, notes: "a\rb" })).toEqual([{ kind: "routineNotes" }]);
    expect(problemsOf(withExercise({ name: "Re\nmo" }))).toEqual([
      { kind: "exercise", field: "name", stage: 1, exercise: 2 },
    ]);
    expect(problemsOf(withExercise({ name: "c".repeat(L.exerciseNameLength + 1) }))).toEqual([
      { kind: "exercise", field: "name", stage: 1, exercise: 2 },
    ]);
    expect(
      problemsOf(withExercise({ name: "Curl", notes: "d".repeat(L.exerciseNotesLength + 1) })),
    ).toEqual([{ kind: "exercise", field: "notes", stage: 1, exercise: 2, exerciseName: "Curl" }]);
    expect(problemsOf({ ...piernas, name: "Pier\ud800nas" })).toEqual([{ kind: "routineName" }]);
  });

  it("refuses reversed or equal rep ranges and values out of range", () => {
    for (const reps of [
      { repsMin: 10, repsMax: 8 },
      { repsMin: 10, repsMax: 10 },
      { repsMin: 0 },
      { repsMin: 1000 },
      { repsMin: 1.5 },
    ]) {
      expect(problemsOf(withExercise({ name: "Curl", ...reps })), JSON.stringify(reps)).toEqual([
        { kind: "exercise", field: "reps", stage: 1, exercise: 2, exerciseName: "Curl" },
      ]);
    }
    expect(problemsOf(withExercise({ name: "Curl", restSeconds: 3601 }))).toEqual([
      { kind: "exercise", field: "rest", stage: 1, exercise: 2, exerciseName: "Curl" },
    ]);
    expect(problemsOf(withExercise({ name: "Curl", weight: 62.55, weightUnit: "kg" }))).toEqual([
      { kind: "exercise", field: "weight", stage: 1, exercise: 2, exerciseName: "Curl" },
    ]);
  });

  it("refuses an empty exercise or stage, and more stages or exercises than allowed", () => {
    expect(problemsOf(withExercise({}))).toEqual([
      { kind: "exercise", field: "empty", stage: 1, exercise: 2 },
    ]);
    expect(problemsOf({ ...piernas, stages: [{ exercises: [] }] })).toEqual([
      { kind: "emptyStage", stage: 1 },
    ]);
    const stage = { exercises: [{ name: "Remo" }] };
    expect(
      problemsOf({ ...piernas, stages: Array.from({ length: L.stages + 1 }, () => stage) }),
    ).toEqual([{ kind: "tooManyStages" }]);
    expect(
      problemsOf({
        ...piernas,
        stages: [
          { exercises: Array.from({ length: L.exercisesPerStage + 1 }, () => ({ repsMin: 1 })) },
        ],
      }),
    ).toEqual([{ kind: "tooManyExercises", stage: 1 }]);
  });

  it("lists every problem at once, in order", () => {
    expect(
      problemsOf({
        ...piernas,
        name: "\u200bPiernas",
        stages: [
          { name: "\u200eA", exercises: [{ name: "Remo", repsMin: 9, repsMax: 8 }] },
          { exercises: [{ name: "Video", link: "https://x_y.com" }] },
        ],
      }),
    ).toEqual([
      { kind: "routineName" },
      { kind: "stageName", stage: 1 },
      { kind: "exercise", field: "reps", stage: 1, exercise: 1, exerciseName: "Remo" },
      { kind: "exercise", field: "link", stage: 2, exercise: 1, exerciseName: "Video" },
    ]);
  });
});

describe("the sender's identity (T25, L56 A3)", () => {
  it("refuses a Google name over 100 characters or with control characters", () => {
    for (const name of ["N".repeat(DIRECTORY_LIMITS.nameLength + 1), "Alice\nLiddell", "A\ud800"]) {
      expect(problemsOf(piernas, { ...alice, name })).toEqual([{ kind: "senderName" }]);
    }
    expect(
      copyOf(piernas, { ...alice, name: "N".repeat(DIRECTORY_LIMITS.nameLength) }).fromName,
    ).toHaveLength(DIRECTORY_LIMITS.nameLength);
  });

  it("refuses a sign-in without a verified email", () => {
    expect(problemsOf(piernas, { ...alice, emailVerified: false })).toEqual([
      { kind: "senderEmail" },
    ]);
    expect(problemsOf(piernas, { ...alice, email: undefined })).toEqual([{ kind: "senderEmail" }]);
    expect(problemsOf(piernas, { ...alice, email: "" })).toEqual([{ kind: "senderEmail" }]);
  });

  it("sends from any email a verified sign-in may hold, and refuses one the recipient could not keep (T29 W4)", () => {
    for (const email of ["a/b@example.com", '"al ice"@example.com', '"a@b"@example.com']) {
      expect(copyOf(piernas, { ...alice, email }).fromEmail).toBe(email);
    }
    // Longer than a recipient keeps, or with a control character: refused before sending.
    for (const email of [`${"e".repeat(ROUTINE_LIMITS.senderEmailLength)}@x.co`, "a\u0007@b.co"]) {
      expect(problemsOf(piernas, { ...alice, email }), email).toEqual([{ kind: "senderEmail" }]);
    }
  });

  it("names the sender's problems before the routine's", () => {
    expect(problemsOf({ ...piernas, name: "\u200bX" }, { ...alice, emailVerified: false })).toEqual(
      [{ kind: "senderEmail" }, { kind: "routineName" }],
    );
  });
});
