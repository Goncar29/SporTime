import { describe, expect, it } from "vite-plus/test";
import {
  ROUTINE_LIMITS,
  formatReps,
  formatRest,
  normalizeRoutineName,
  parseRepsInput,
  parseRestInput,
  parseRoutine,
  parseWeightInput,
  sanitizeExercise,
  toStoredRoutine,
  type RoutineDraft,
} from "./routine";

describe("normalizeRoutineName", () => {
  it("trims the name and keeps any script", () => {
    expect(normalizeRoutineName("  Empuje día A 💪 ")).toBe("Empuje día A 💪");
  });

  it("requires a visible name within the limit", () => {
    expect(normalizeRoutineName("   ")).toBeNull();
    expect(normalizeRoutineName("\u200b\u0001")).toBeNull();
    expect(normalizeRoutineName("a".repeat(ROUTINE_LIMITS.nameLength))).not.toBeNull();
    expect(normalizeRoutineName("a".repeat(ROUTINE_LIMITS.nameLength + 1))).toBeNull();
  });
});

describe("parseRepsInput", () => {
  it("accepts an empty field", () => {
    expect(parseRepsInput("  ")).toEqual({});
  });

  it("accepts one value", () => {
    expect(parseRepsInput("10")).toEqual({ repsMin: 10 });
  });

  it("accepts a range like 8 - 10, with or without spaces", () => {
    expect(parseRepsInput("8 - 10")).toEqual({ repsMin: 8, repsMax: 10 });
    expect(parseRepsInput("8-10")).toEqual({ repsMin: 8, repsMax: 10 });
    expect(parseRepsInput("8 – 10")).toEqual({ repsMin: 8, repsMax: 10 });
  });

  it("reads a range of one number as that number", () => {
    expect(parseRepsInput("8-8")).toEqual({ repsMin: 8 });
  });

  it("rejects text, zero, reversed ranges and values over the limit", () => {
    expect(parseRepsInput("diez")).toBeNull();
    expect(parseRepsInput("0")).toBeNull();
    expect(parseRepsInput("10 - 8")).toBeNull();
    expect(parseRepsInput(String(ROUTINE_LIMITS.reps.max + 1))).toBeNull();
  });
});

describe("formatReps", () => {
  it("shows nothing, one value, or the range", () => {
    expect(formatReps({})).toBe("");
    expect(formatReps({ repsMin: 10 })).toBe("10");
    expect(formatReps({ repsMin: 8, repsMax: 10 })).toBe("8 - 10");
  });
});

describe("parseRestInput", () => {
  it("accepts an empty field", () => {
    expect(parseRestInput("")).toBeUndefined();
  });

  it("reads seconds written like 90, 90', 90'' or 90s", () => {
    for (const text of ["90", "90'", "90''", '90"', "90s", " 90 '' "]) {
      expect(parseRestInput(text)).toBe(90);
    }
  });

  it("reads minutes and seconds like 1:30", () => {
    expect(parseRestInput("1:30")).toBe(90);
  });

  it("rejects text and values over the limit", () => {
    expect(parseRestInput("un rato")).toBeNull();
    expect(parseRestInput("1:75")).toBeNull();
    expect(parseRestInput(String(ROUTINE_LIMITS.restSeconds.max + 1))).toBeNull();
  });

  it("is shown like 90''", () => {
    expect(formatRest(90)).toBe("90''");
  });
});

describe("parseWeightInput", () => {
  it("accepts an empty field", () => {
    expect(parseWeightInput(" ")).toBeUndefined();
  });

  it("reads whole and decimal weights, with a point or a comma", () => {
    expect(parseWeightInput("60")).toBe(60);
    expect(parseWeightInput("62.5")).toBe(62.5);
    expect(parseWeightInput("62,5")).toBe(62.5);
  });

  it("rejects text, more than one decimal and values over the limit", () => {
    expect(parseWeightInput("pesado")).toBeNull();
    expect(parseWeightInput("62.55")).toBeNull();
    expect(parseWeightInput(String(ROUTINE_LIMITS.weight.max + 1))).toBeNull();
  });
});

describe("sanitizeExercise", () => {
  it("discards an exercise with no field filled", () => {
    expect(sanitizeExercise({})).toBeNull();
    expect(sanitizeExercise({ name: "  ", notes: "" })).toBeNull();
  });

  it("keeps any single field on its own", () => {
    expect(sanitizeExercise({ name: "Sentadilla" })).toEqual({ name: "Sentadilla" });
    expect(sanitizeExercise({ repsMin: 8, repsMax: 10 })).toEqual({ repsMin: 8, repsMax: 10 });
    expect(sanitizeExercise({ restSeconds: 90 })).toEqual({ restSeconds: 90 });
  });

  it("gives a weight kg unless it says lb, and drops a unit without a weight", () => {
    expect(sanitizeExercise({ weight: 60 })).toEqual({ weight: 60, weightUnit: "kg" });
    expect(sanitizeExercise({ weight: 60, weightUnit: "lb" })).toEqual({
      weight: 60,
      weightUnit: "lb",
    });
    expect(sanitizeExercise({ name: "Remo", weightUnit: "lb" })).toEqual({ name: "Remo" });
  });

  it("drops fields that are out of range or of the wrong type", () => {
    expect(
      sanitizeExercise({
        name: "Press",
        repsMin: 0,
        restSeconds: -5,
        weight: "60",
        notes: 42,
      }),
    ).toEqual({ name: "Press" });
  });

  it("drops half of a broken character, which Firestore would refuse forever", () => {
    expect(sanitizeExercise({ name: "Remo\uD800", notes: "\uDC00lento" })).toEqual({
      name: "Remo",
      notes: "lento",
    });
    expect(normalizeRoutineName("Pierna\uD83D")).toBe("Pierna");
    expect(
      parseRoutine("r", { name: "R", notes: "a\uDFFFb", createdAt: 1, stages: [] })?.notes,
    ).toBe("ab");
    expect(normalizeRoutineName("Pecho 💪")).toBe("Pecho 💪");
  });

  it("turns control characters into spaces so text stays on one line", () => {
    expect(sanitizeExercise({ name: "Press\tbanca\nplano" })).toEqual({
      name: "Press banca plano",
    });
  });
});

const sample: RoutineDraft = {
  name: "Empuje",
  notes: "Calentar bien.\nHombros primero.",
  createdAt: 1_700_000_000_000,
  stages: [
    {
      name: "Bloque A",
      notes: "Superserie",
      exercises: [
        {
          name: "Press banca",
          repsMin: 8,
          repsMax: 10,
          restSeconds: 90,
          weight: 62.5,
          weightUnit: "kg",
          notes: "Pausa abajo",
        },
        { repsMin: 12 },
      ],
    },
    { exercises: [{ weight: 20, weightUnit: "lb" }] },
  ],
};

describe("stored routines", () => {
  it("survive a round trip through the stored shape", () => {
    expect(parseRoutine("r1", toStoredRoutine(sample))).toEqual({ id: "r1", ...sample });
  });

  it("are read in the app's own shape too, as the outbox keeps them", () => {
    expect(parseRoutine("r1", sample)).toEqual({ id: "r1", ...sample });
  });

  it("store each stage's exercises as one line each, which the rules can check", () => {
    const stored = toStoredRoutine(sample);
    expect(stored.stages[0]!.exercises).toBe(
      "Press banca\t8-10\t90\t62.5kg\tPausa abajo\n\t12\t\t\t",
    );
    expect(stored.stages[1]).toEqual({ exercises: "\t\t\t20lb\t" });
  });

  it("leave empty optional fields out instead of storing them empty", () => {
    const stored = toStoredRoutine({ name: "Solo", createdAt: 1, stages: [] });
    expect(stored).toEqual({ name: "Solo", createdAt: 1, stages: [] });
  });

  it("drop empty exercises and stages before storing", () => {
    const stored = toStoredRoutine({
      name: "Con huecos",
      createdAt: 1,
      stages: [{ exercises: [{}, { name: "Dominadas" }] }, { name: " ", exercises: [{}] }],
    });
    expect(stored.stages).toEqual([{ exercises: "Dominadas\t\t\t\t" }]);
  });

  it("keep at most the stage and exercise limits", () => {
    const many = Array.from({ length: ROUTINE_LIMITS.stages + 3 }, () => ({
      exercises: Array.from({ length: ROUTINE_LIMITS.exercisesPerStage + 3 }, () => ({
        repsMin: 5,
      })),
    }));
    const routine = parseRoutine("r", { name: "Mucho", createdAt: 1, stages: many });
    expect(routine?.stages).toHaveLength(ROUTINE_LIMITS.stages);
    expect(routine?.stages[0]!.exercises).toHaveLength(ROUTINE_LIMITS.exercisesPerStage);
  });

  it("reject data without a valid name or creation time", () => {
    expect(parseRoutine("r", { name: " ", createdAt: 1, stages: [] })).toBeNull();
    expect(parseRoutine("r", { name: "Ok", createdAt: "ayer", stages: [] })).toBeNull();
    expect(parseRoutine("r", null)).toBeNull();
  });

  it("read malformed stages as no stages rather than failing", () => {
    expect(parseRoutine("r", { name: "Ok", createdAt: 1, stages: "x" })?.stages).toEqual([]);
    expect(
      parseRoutine("r", { name: "Ok", createdAt: 1, stages: [{ exercises: "\tnope\t\t\t" }] })
        ?.stages,
    ).toEqual([]);
  });
});
