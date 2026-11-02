import { describe, expect, it } from "vite-plus/test";
import { buildTimeline, locate } from "./timeline";
import { defaultConfig, type WorkoutConfig } from "./workout";

const config = (
  overrides: Partial<WorkoutConfig> & Pick<WorkoutConfig, "mode">,
): WorkoutConfig => ({
  ...defaultConfig(overrides.mode),
  prepareSeconds: 0,
  ...overrides,
});

const shape = (config: WorkoutConfig) =>
  buildTimeline(config).phases.map((p) => [p.kind, p.durationMs, p.round, p.set]);

describe("buildTimeline", () => {
  it("stopwatch is one open-ended count-up phase with no total", () => {
    const timeline = buildTimeline(config({ mode: "stopwatch" }));
    expect(timeline.totalMs).toBeNull();
    expect(timeline.phases).toHaveLength(1);
    expect(timeline.phases[0]).toMatchObject({
      kind: "work",
      durationMs: null,
      display: "countup",
    });
  });

  it("adds a prepare phase before the workout only when configured", () => {
    const withPrepare = buildTimeline(
      config({ mode: "amrap", workSeconds: 60, prepareSeconds: 10 }),
    );
    expect(withPrepare.phases.map((p) => p.kind)).toEqual(["prepare", "work"]);
    expect(withPrepare.totalMs).toBe(70_000);
    expect(
      buildTimeline(config({ mode: "amrap", workSeconds: 60 })).phases.map((p) => p.kind),
    ).toEqual(["work"]);
  });

  it("AMRAP without pauses is a single continuous countdown", () => {
    expect(shape(config({ mode: "amrap", workSeconds: 600, sets: 1 }))).toEqual([
      ["work", 600_000, 1, 1],
    ]);
  });

  it("AMRAP with several sets rests between sets but not after the last", () => {
    expect(shape(config({ mode: "amrap", workSeconds: 300, sets: 2, setRestSeconds: 60 }))).toEqual(
      [
        ["work", 300_000, 1, 1],
        ["setRest", 60_000, 1, 1],
        ["work", 300_000, 1, 2],
      ],
    );
  });

  it("For Time counts up to its cap", () => {
    const timeline = buildTimeline(config({ mode: "forTime", workSeconds: 900, sets: 1 }));
    expect(timeline.phases[0]).toMatchObject({
      kind: "work",
      durationMs: 900_000,
      display: "countup",
    });
  });

  it("EMOM chains work intervals with no rest phases", () => {
    expect(shape(config({ mode: "emom", workSeconds: 60, rounds: 3, sets: 1 }))).toEqual([
      ["work", 60_000, 1, 1],
      ["work", 60_000, 2, 1],
      ["work", 60_000, 3, 1],
    ]);
  });

  it("classic Tabata is 8 rounds of 20/10 lasting 3:50 without the trailing rest", () => {
    const timeline = buildTimeline(config({ mode: "tabata" }));
    expect(timeline.phases.filter((p) => p.kind === "work")).toHaveLength(8);
    expect(timeline.phases.filter((p) => p.kind === "rest")).toHaveLength(7);
    expect(timeline.totalMs).toBe(230_000);
    expect(timeline.phases.at(-1)?.kind).toBe("work");
  });

  it("intervals replace the last rest of a set with the rest between sets", () => {
    expect(
      shape(
        config({
          mode: "intervals",
          workSeconds: 30,
          restSeconds: 10,
          rounds: 2,
          sets: 2,
          setRestSeconds: 60,
        }),
      ),
    ).toEqual([
      ["work", 30_000, 1, 1],
      ["rest", 10_000, 1, 1],
      ["work", 30_000, 2, 1],
      ["setRest", 60_000, 2, 1],
      ["work", 30_000, 1, 2],
      ["rest", 10_000, 1, 2],
      ["work", 30_000, 2, 2],
    ]);
  });

  it("zero rest means training without pauses", () => {
    const kinds = buildTimeline(
      config({
        mode: "intervals",
        workSeconds: 30,
        restSeconds: 0,
        rounds: 2,
        sets: 2,
        setRestSeconds: 0,
      }),
    ).phases.map((p) => p.kind);
    expect(kinds).toEqual(["work", "work", "work", "work"]);
  });

  it("phase starts are cumulative", () => {
    const { phases } = buildTimeline(config({ mode: "tabata", rounds: 2 }));
    expect(phases.map((p) => p.startMs)).toEqual([0, 20_000, 30_000]);
  });
});

describe("locate", () => {
  const timeline = buildTimeline(config({ mode: "tabata", rounds: 2 }));

  it("finds the phase and its elapsed and remaining time", () => {
    expect(locate(timeline, 25_000)).toMatchObject({
      index: 1,
      elapsedInPhaseMs: 5_000,
      remainingInPhaseMs: 5_000,
    });
  });

  it("a phase boundary belongs to the next phase", () => {
    expect(locate(timeline, 20_000).index).toBe(1);
  });

  it("past the end stays on the last phase with nothing remaining", () => {
    expect(locate(timeline, 999_000)).toMatchObject({ index: 2, remainingInPhaseMs: 0 });
  });

  it("open-ended phases have no remaining time", () => {
    const stopwatch = buildTimeline(config({ mode: "stopwatch" }));
    expect(locate(stopwatch, 5_000)).toMatchObject({
      index: 0,
      elapsedInPhaseMs: 5_000,
      remainingInPhaseMs: null,
    });
  });
});
