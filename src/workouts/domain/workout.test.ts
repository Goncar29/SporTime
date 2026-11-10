import { describe, expect, it } from "vite-plus/test";
import {
  MAX_ROUND_NAME_LENGTH,
  MODES,
  defaultConfig,
  hasRoundNames,
  normalizeRoundName,
  parseConfig,
  sanitizeConfig,
  stepDuration,
  toStoredConfig,
} from "./workout";

describe("defaultConfig", () => {
  it("Tabata defaults to 20s work, 10s rest and 8 rounds", () => {
    expect(defaultConfig("tabata")).toMatchObject({
      workSeconds: 20,
      restSeconds: 10,
      rounds: 8,
      sets: 1,
    });
  });
});

describe("sanitizeConfig", () => {
  it("falls back to defaults for missing or malformed values", () => {
    expect(sanitizeConfig("amrap", { workSeconds: "nope", sets: null })).toEqual(
      defaultConfig("amrap"),
    );
    expect(sanitizeConfig("amrap", "garbage")).toEqual(defaultConfig("amrap"));
  });

  it("clamps values to the allowed range and whole numbers", () => {
    const result = sanitizeConfig("tabata", {
      workSeconds: 0,
      restSeconds: -5,
      rounds: 5000,
      sets: 2.7,
    });
    expect(result).toMatchObject({ workSeconds: 1, restSeconds: 0, rounds: 99, sets: 2 });
  });

  it("keeps the requested mode regardless of stored data", () => {
    expect(sanitizeConfig("emom", { mode: "tabata" }).mode).toBe("emom");
  });
});

describe("stepDuration", () => {
  it("uses finer steps for short durations", () => {
    expect(stepDuration(30, 1)).toBe(35);
    expect(stepDuration(120, 1)).toBe(135);
    expect(stepDuration(600, 1)).toBe(660);
    expect(stepDuration(1500, 1)).toBe(1800);
  });

  it("stepping down across a boundary uses the finer step", () => {
    expect(stepDuration(60, -1)).toBe(55);
    expect(stepDuration(300, -1)).toBe(285);
    expect(stepDuration(1200, -1)).toBe(1140);
  });

  it("snaps an unaligned value to the next step", () => {
    expect(stepDuration(33, 1)).toBe(35);
    expect(stepDuration(33, -1)).toBe(30);
  });
});

describe("round names", () => {
  it("are offered only by the modes that have rounds of work", () => {
    expect(MODES.filter(({ id }) => hasRoundNames(id)).map(({ id }) => id)).toEqual([
      "emom",
      "tabata",
      "intervals",
    ]);
  });

  it("trim a name and treat one with nothing visible as unnamed", () => {
    expect(normalizeRoundName("  Burpees ")).toBe("Burpees");
    expect(normalizeRoundName("   ")).toBe("");
    expect(normalizeRoundName("\u200b\u0085")).toBe("");
    expect(normalizeRoundName(7)).toBe("");
    expect(normalizeRoundName("Sentadillas 💪")).toBe("Sentadillas 💪");
  });

  it("treat a name that is too long or has control characters as unnamed", () => {
    expect(MAX_ROUND_NAME_LENGTH).toBe(24);
    expect(normalizeRoundName("a".repeat(24))).toBe("a".repeat(24));
    expect(normalizeRoundName("a".repeat(25))).toBe("");
    expect(normalizeRoundName("Push\nPull")).toBe("");
  });

  it("are kept per round, without trailing unnamed rounds or rounds past the last", () => {
    const config = sanitizeConfig("tabata", {
      ...defaultConfig("tabata"),
      rounds: 3,
      roundNames: [" Burpees", "", "Squats", "Lunges", "  "],
    });
    expect(config.roundNames).toEqual(["Burpees", "", "Squats"]);
    expect(
      sanitizeConfig("tabata", { rounds: 3, roundNames: ["Burpees", "  ", 7] }).roundNames,
    ).toEqual(["Burpees"]);
  });

  it("are left out when no round has one, so old configs stay the same", () => {
    const old = { ...defaultConfig("tabata") };
    expect(parseConfig(old)).toEqual(old);
    expect(parseConfig(old)).not.toHaveProperty("roundNames");
    expect(sanitizeConfig("tabata", { roundNames: ["", " "] })).not.toHaveProperty("roundNames");
    expect(sanitizeConfig("tabata", { roundNames: "\n \n" })).not.toHaveProperty("roundNames");
  });

  it("are stored as one line of text per round, so stored data only holds text", () => {
    const stored = toStoredConfig({
      ...defaultConfig("tabata"),
      roundNames: [" Burpees ", "", "Squats", "  "],
    });
    expect(stored).toEqual({ ...defaultConfig("tabata"), roundNames: "Burpees\n\nSquats" });
    expect(parseConfig(stored)).toEqual({
      ...defaultConfig("tabata"),
      roundNames: ["Burpees", "", "Squats"],
    });
  });

  it("store a config without names exactly as before", () => {
    expect(toStoredConfig(defaultConfig("tabata"))).toEqual(defaultConfig("tabata"));
    expect(toStoredConfig({ ...defaultConfig("emom"), roundNames: ["", " "] })).toEqual(
      defaultConfig("emom"),
    );
  });

  it("read stored lines past the last round, or that are not names, as unnamed", () => {
    expect(
      parseConfig({ ...defaultConfig("tabata"), rounds: 2, roundNames: "Burpees\nSquats\nLunges" })
        ?.roundNames,
    ).toEqual(["Burpees", "Squats"]);
    expect(
      parseConfig({ ...defaultConfig("tabata"), roundNames: `${"a".repeat(25)}\nSquats` })
        ?.roundNames,
    ).toEqual(["", "Squats"]);
    for (const roundNames of [7, null, { 0: "Burpees" }]) {
      expect(parseConfig({ ...defaultConfig("tabata"), roundNames })).toEqual(
        defaultConfig("tabata"),
      );
    }
  });

  it("are dropped by modes without rounds", () => {
    expect(sanitizeConfig("amrap", { roundNames: ["Burpees"] })).toEqual(defaultConfig("amrap"));
  });
});
