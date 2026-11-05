import { describe, expect, it } from "vite-plus/test";
import { buildTimeline, type Timeline } from "../../workouts/domain/timeline";
import { defaultConfig } from "../../workouts/domain/workout";
import { BEFORE_START, finishEvent, latestEvent } from "./cues";
import { DEFAULT_SOUND_SETTINGS, type SoundSettings } from "./soundSettings";

// The default settings must keep every sound the app always made.
const latestCue = (workout: Timeline, fromMs: number, toMs: number) =>
  latestEvent(workout, fromMs, toMs, DEFAULT_SOUND_SETTINGS)?.cue ?? null;

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

describe("latestEvent with sound settings", () => {
  const voiceOn: SoundSettings = { ...DEFAULT_SOUND_SETTINGS, voice: true };
  // prepare 0-5s, work 5-25s, rest 25-35s, work 35-55s
  const at = (fromMs: number, toMs: number, sound: SoundSettings) =>
    latestEvent(timeline, fromMs, toMs, sound);

  it("plays the tone and says nothing with the voice off", () => {
    expect(at(4_900, 5_000, DEFAULT_SOUND_SETTINGS)).toEqual({
      cue: "work",
      tone: true,
      announcement: null,
    });
    expect(at(1_900, 2_000, DEFAULT_SOUND_SETTINGS)).toEqual({
      cue: "tick",
      tone: true,
      announcement: null,
    });
  });

  it("says the interval name, every kind included", () => {
    const named = (fromMs: number, toMs: number) => at(fromMs, toMs, voiceOn)?.announcement;
    expect(named(BEFORE_START, 0)).toEqual({ kind: "phase", phase: "prepare" });
    expect(named(4_900, 5_000)).toEqual({ kind: "phase", phase: "work" });
    expect(named(24_900, 25_000)).toEqual({ kind: "phase", phase: "rest" });
    const withSets = buildTimeline({ ...defaultConfig("intervals"), prepareSeconds: 0, sets: 2 });
    const setRest = withSets.phases.find(({ kind }) => kind === "setRest");
    if (!setRest) throw new Error("Expected a rest between sets");
    expect(
      latestEvent(withSets, setRest.startMs - 1, setRest.startMs, voiceOn)?.announcement,
    ).toEqual({ kind: "phase", phase: "setRest" });
  });

  it("keeps the interval tone beside the name, and drops only what is switched off", () => {
    expect(at(4_900, 5_000, voiceOn)).toMatchObject({ cue: "work", tone: true });
    expect(at(4_900, 5_000, { ...voiceOn, intervalSound: false })).toEqual({
      cue: "work",
      tone: false,
      announcement: { kind: "phase", phase: "work" },
    });
    expect(at(4_900, 5_000, { ...voiceOn, intervalName: false })).toEqual({
      cue: "work",
      tone: true,
      announcement: null,
    });
  });

  it("says 3-2-1 instead of ticking, and has neither when the countdown is off", () => {
    expect(at(1_900, 2_000, voiceOn)).toEqual({
      cue: "tick",
      tone: false,
      announcement: { kind: "count", seconds: 3 },
    });
    expect(at(3_900, 4_000, voiceOn)?.announcement).toEqual({ kind: "count", seconds: 1 });
    expect(at(1_900, 2_000, { ...voiceOn, countdown: false })).toBeNull();
    expect(at(1_900, 2_000, { ...DEFAULT_SOUND_SETTINGS, countdown: false })).toBeNull();
  });

  it("says when 10 seconds are left, only in an interval longer than that", () => {
    expect(at(14_900, 15_000, voiceOn)?.announcement).toEqual({ kind: "tenSecondsLeft" });
    // Rest lasts exactly 10 seconds, so its start is not also a warning.
    expect(at(24_900, 25_000, voiceOn)?.announcement).toEqual({ kind: "phase", phase: "rest" });
    expect(at(14_900, 15_000, { ...voiceOn, tenSecondsLeft: false, halfway: false })).toBeNull();
  });

  it("says when an interval is halfway through", () => {
    // Rest 25-35s: halfway at 30s.
    expect(at(29_900, 30_000, voiceOn)?.announcement).toEqual({ kind: "halfway" });
    expect(at(29_900, 30_000, { ...voiceOn, halfway: false })).toBeNull();
  });

  it("does not lose the halfway warning when it shares its moment with the 10 seconds one", () => {
    // Work 5-25s: 10 seconds left and halfway are both at 15s.
    expect(at(14_900, 15_000, { ...voiceOn, tenSecondsLeft: false })?.announcement).toEqual({
      kind: "halfway",
    });
  });

  it("warns nothing during the prepare phase, beyond its countdown", () => {
    const longPrepare = buildTimeline({ ...defaultConfig("tabata"), prepareSeconds: 30 });
    expect(latestEvent(longPrepare, 14_900, 15_000, voiceOn)).toBeNull();
    expect(latestEvent(longPrepare, 19_900, 20_000, voiceOn)).toBeNull();
  });

  it("says nothing beyond tones when the voice is off, whatever its options say", () => {
    expect(at(14_900, 15_000, DEFAULT_SOUND_SETTINGS)).toBeNull();
    expect(at(29_900, 30_000, DEFAULT_SOUND_SETTINGS)).toBeNull();
    expect(at(BEFORE_START, 0, DEFAULT_SOUND_SETTINGS)).toBeNull();
  });

  it("announces the finish by name and tone, each with its own switch", () => {
    expect(at(54_900, 55_000, voiceOn)).toEqual({
      cue: "finish",
      tone: true,
      announcement: { kind: "finish" },
    });
    expect(finishEvent(voiceOn)).toEqual({
      cue: "finish",
      tone: true,
      announcement: { kind: "finish" },
    });
    expect(finishEvent({ ...DEFAULT_SOUND_SETTINGS, intervalSound: false })).toEqual({
      cue: "finish",
      tone: false,
      announcement: null,
    });
  });
});
