import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../../workouts/domain/workout";
import { MAX_ACTIVE_MS, MAX_MARKS, createHistoryDraft, parseHistoryEntry } from "./historyEntry";

const config = defaultConfig("amrap");

describe("createHistoryDraft", () => {
  it("records the workout, the finish time, the time trained and the mark count", () => {
    expect(createHistoryDraft({ config, activeElapsedMs: 1_500.7, markCount: 3, now: 9 })).toEqual({
      config,
      finishedAt: 9,
      activeMs: 1_500,
      marks: 3,
    });
  });

  it("caps values at what the security rules accept", () => {
    const draft = createHistoryDraft({
      config,
      activeElapsedMs: MAX_ACTIVE_MS + 1,
      markCount: MAX_MARKS + 1,
      now: 9,
    });
    expect(draft.activeMs).toBe(MAX_ACTIVE_MS);
    expect(draft.marks).toBe(MAX_MARKS);
  });
});

describe("parseHistoryEntry", () => {
  const raw = { config, finishedAt: 9, activeMs: 1_500, marks: 3 };

  it("reads a valid document", () => {
    expect(parseHistoryEntry("h1", raw)).toEqual({ id: "h1", ...raw });
  });

  it("ignores documents it cannot read", () => {
    expect(parseHistoryEntry("h1", undefined)).toBeNull();
    expect(parseHistoryEntry("h1", { ...raw, finishedAt: "x" })).toBeNull();
    expect(parseHistoryEntry("h1", { ...raw, finishedAt: 8_640_000_000_000_001 })).toBeNull();
    expect(parseHistoryEntry("h1", { ...raw, activeMs: null })).toBeNull();
    expect(parseHistoryEntry("h1", { ...raw, marks: "3" })).toBeNull();
    expect(parseHistoryEntry("h1", { ...raw, config: {} })).toBeNull();
  });
});
