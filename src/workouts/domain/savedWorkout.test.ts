import { describe, expect, it } from "vite-plus/test";
import { MAX_WORKOUT_NAME_LENGTH, normalizeWorkoutName, parseSavedWorkout } from "./savedWorkout";
import { defaultConfig } from "./workout";

describe("normalizeWorkoutName", () => {
  it("trims the name", () => {
    expect(normalizeWorkoutName("  Leg day ")).toBe("Leg day");
  });

  it("rejects a blank name", () => {
    expect(normalizeWorkoutName("   ")).toBeNull();
  });

  it("rejects a name with nothing visible in it", () => {
    expect(normalizeWorkoutName("\u0001\u0002")).toBeNull();
    expect(normalizeWorkoutName("\u200b\u0085")).toBeNull();
  });

  it("keeps names in any script, and emoji", () => {
    expect(normalizeWorkoutName("Día de piernas 💪")).toBe("Día de piernas 💪");
    expect(normalizeWorkoutName("脚の日")).toBe("脚の日");
  });

  it("accepts the longest name and rejects anything longer", () => {
    expect(normalizeWorkoutName("a".repeat(MAX_WORKOUT_NAME_LENGTH))).not.toBeNull();
    expect(normalizeWorkoutName("a".repeat(MAX_WORKOUT_NAME_LENGTH + 1))).toBeNull();
  });
});

describe("parseSavedWorkout", () => {
  const raw = { name: "Leg day", config: defaultConfig("emom"), createdAt: 5 };

  it("reads a valid document", () => {
    expect(parseSavedWorkout("w1", raw)).toEqual({ id: "w1", ...raw });
  });

  it("reads a workout saved before rounds had names", () => {
    const parsed = parseSavedWorkout("w1", raw);
    expect(parsed?.config).toEqual(defaultConfig("emom"));
    expect(parsed?.config).not.toHaveProperty("roundNames");
  });

  it("keeps the round names, and turns invalid ones into unnamed rounds", () => {
    const config = { ...defaultConfig("emom"), roundNames: ["Burpees", "a".repeat(25), "Squats"] };
    expect(parseSavedWorkout("w1", { ...raw, config })?.config.roundNames).toEqual([
      "Burpees",
      "",
      "Squats",
    ]);
  });

  it("clamps numbers that are out of range", () => {
    const config = { ...defaultConfig("emom"), rounds: 5_000 };
    expect(parseSavedWorkout("w1", { ...raw, config })?.config.rounds).toBe(99);
  });

  it("ignores documents it cannot read", () => {
    expect(parseSavedWorkout("w1", null)).toBeNull();
    expect(parseSavedWorkout("w1", { ...raw, name: 7 })).toBeNull();
    expect(parseSavedWorkout("w1", { ...raw, createdAt: "x" })).toBeNull();
    expect(parseSavedWorkout("w1", { ...raw, createdAt: 8_640_000_000_000_001 })).toBeNull();
    expect(parseSavedWorkout("w1", { ...raw, config: { mode: "yoga" } })).toBeNull();
    expect(parseSavedWorkout("w1", { ...raw, config: null })).toBeNull();
  });
});
