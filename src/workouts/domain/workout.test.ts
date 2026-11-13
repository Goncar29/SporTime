import { describe, expect, it } from "vite-plus/test";
import {
  MAX_ROUND_NAME_LENGTH,
  MODES,
  defaultConfig,
  sameConfig,
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

describe("parseConfig round names", () => {
  const tabata = defaultConfig("tabata");

  it("reads them as Firestore stores them, one per line", () => {
    expect(parseConfig({ ...tabata, roundNames: "Burpees\n\nSquats" })).toEqual({
      ...tabata,
      roundNames: ["Burpees", "", "Squats"],
    });
  });

  it("reads them as the outbox keeps them, as a list", () => {
    expect(parseConfig({ ...tabata, roundNames: ["Burpees", "", "Squats"] })).toEqual({
      ...tabata,
      roundNames: ["Burpees", "", "Squats"],
    });
  });

  it("gives the config without names when the field is missing", () => {
    const parsed = parseConfig(tabata);
    expect(parsed).toEqual(tabata);
    expect(parsed).not.toHaveProperty("roundNames");
  });

  it("gives the config without names for anything that is not names", () => {
    for (const roundNames of [7, null, { 0: "Burpees" }, true, [7, {}], "", "\n\n"]) {
      const parsed = parseConfig({ ...tabata, roundNames });
      expect(parsed).toEqual(tabata);
      expect(parsed).not.toHaveProperty("roundNames");
    }
  });

  it("cuts names past the last round", () => {
    const twoRounds = { ...tabata, rounds: 2 };
    expect(parseConfig({ ...twoRounds, roundNames: "A\nB\nC\nD" })?.roundNames).toEqual(["A", "B"]);
    expect(parseConfig({ ...twoRounds, roundNames: ["A", "B", "C"] })?.roundNames).toEqual([
      "A",
      "B",
    ]);
  });

  it("drops them in AMRAP, which has no rounds of work", () => {
    const amrap = defaultConfig("amrap");
    expect(parseConfig({ ...amrap, roundNames: "Burpees" })).toEqual(amrap);
    expect(parseConfig({ ...amrap, roundNames: ["Burpees"] })).toEqual(amrap);
  });

  it("treats a name with a control character as unnamed", () => {
    expect(parseConfig({ ...tabata, roundNames: "Push\u0007ups\nSquats" })?.roundNames).toEqual([
      "",
      "Squats",
    ]);
    expect(parseConfig({ ...tabata, roundNames: ["Push\tups", "Squats"] })?.roundNames).toEqual([
      "",
      "Squats",
    ]);
  });

  it("round-trips a config through toStoredConfig unchanged", () => {
    const configs = [
      tabata,
      { ...tabata, rounds: 4, roundNames: ["Burpees", "", "Sentadillas 💪", "Ñandú"] },
      { ...defaultConfig("emom"), roundNames: ["", "Row"] },
      { ...defaultConfig("intervals"), roundNames: ["é".repeat(24)] },
    ];
    for (const config of configs) {
      expect(parseConfig(toStoredConfig(config))).toEqual(config);
    }
  });
});

describe("sameConfig", () => {
  const tabata = defaultConfig("tabata");

  it("is true for the same settings, whatever order their fields were written in", () => {
    const reordered = Object.fromEntries(Object.entries(tabata).reverse()) as typeof tabata;
    expect(sameConfig(tabata, reordered)).toBe(true);
  });

  it("is false when a setting differs", () => {
    expect(sameConfig(tabata, { ...tabata, rounds: tabata.rounds + 1 })).toBe(false);
    expect(sameConfig(tabata, { ...tabata, mode: "emom" })).toBe(false);
  });

  it("compares round names in order, and none as different from some", () => {
    const named = { ...tabata, roundNames: ["Squats", "Push-ups"] };
    expect(sameConfig(named, { ...tabata, roundNames: ["Squats", "Push-ups"] })).toBe(true);
    expect(sameConfig(named, { ...tabata, roundNames: ["Push-ups", "Squats"] })).toBe(false);
    expect(sameConfig(named, tabata)).toBe(false);
  });
});
