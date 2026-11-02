import { describe, expect, it } from "vite-plus/test";
import { defaultConfig, sanitizeConfig, stepDuration } from "./workout";

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
