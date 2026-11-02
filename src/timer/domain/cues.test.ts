import { describe, expect, it } from "vite-plus/test";
import { buildTimeline } from "../../workouts/domain/timeline";
import { defaultConfig } from "../../workouts/domain/workout";
import { BEFORE_START, latestCue } from "./cues";

const timeline = buildTimeline({ ...defaultConfig("tabata"), prepareSeconds: 5, rounds: 2 });
// prepare 0-5s, work 5-25s, rest 25-35s, work 35-55s

describe("latestCue", () => {
  it("is silent when no cue point was crossed", () => {
    expect(latestCue(timeline, 6_000, 6_100)).toBeNull();
    expect(latestCue(timeline, 6_000, 6_000)).toBeNull();
  });

  it("counts down the last three seconds of a phase", () => {
    expect(latestCue(timeline, 1_900, 2_000)).toBe("tick");
    expect(latestCue(timeline, 2_900, 3_000)).toBe("tick");
    expect(latestCue(timeline, 3_900, 4_000)).toBe("tick");
    expect(latestCue(timeline, 1_800, 1_900)).toBeNull();
  });

  it("announces work and rest when their phases start", () => {
    expect(latestCue(timeline, 4_900, 5_000)).toBe("work");
    expect(latestCue(timeline, 24_900, 25_000)).toBe("rest");
  });

  it("announces the finish at the end of the workout", () => {
    expect(latestCue(timeline, 54_900, 55_000)).toBe("finish");
  });

  it("after a long gap plays only the latest cue instead of a burst", () => {
    expect(latestCue(timeline, 6_000, 26_000)).toBe("rest");
  });

  it("announces work when a workout starts without a prepare phase", () => {
    const noPrepare = buildTimeline({ ...defaultConfig("amrap"), prepareSeconds: 0 });
    expect(latestCue(noPrepare, BEFORE_START, 0)).toBe("work");
  });

  it("stays silent at the start of a prepare phase", () => {
    expect(latestCue(timeline, BEFORE_START, 0)).toBeNull();
  });

  it("open-ended phases have no countdown or finish", () => {
    const stopwatch = buildTimeline({ ...defaultConfig("stopwatch"), prepareSeconds: 0 });
    expect(latestCue(stopwatch, 0, 86_400_000)).toBeNull();
  });

  it("does not tick before the start of a very short phase", () => {
    const short = buildTimeline({
      ...defaultConfig("intervals"),
      prepareSeconds: 0,
      workSeconds: 2,
      restSeconds: 0,
      rounds: 2,
      sets: 1,
    });
    expect(latestCue(short, 0, 500)).toBeNull();
    expect(latestCue(short, 900, 1_000)).toBe("tick");
  });
});
