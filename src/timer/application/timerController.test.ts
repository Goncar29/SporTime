import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { buildTimeline } from "../../workouts/domain/timeline";
import { defaultConfig } from "../../workouts/domain/workout";
import { DEFAULT_SOUND_SETTINGS, type SoundSettings } from "../domain/soundSettings";
import { createTimerController } from "./timerController";

const timeline = buildTimeline({ ...defaultConfig("tabata"), prepareSeconds: 5, rounds: 2 });

function setup(workout = timeline, sound: SoundSettings = DEFAULT_SOUND_SETTINGS) {
  let now = 1_000;
  const cues = { unlock: vi.fn(), play: vi.fn(), vibrate: vi.fn() };
  const voice = { unlock: vi.fn(), canSpeak: vi.fn(() => true), say: vi.fn() };
  const screenAwake = { acquire: vi.fn(), release: vi.fn() };
  const controller = createTimerController({
    timeline: workout,
    clock: { now: () => now },
    cues,
    voice,
    sound,
    screenAwake,
  });
  return {
    controller,
    cues,
    voice,
    screenAwake,
    advanceTo(ms: number) {
      now = 1_000 + ms;
      controller.tick();
    },
  };
}

describe("timerController", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("starts idle at the beginning of the first phase", () => {
    expect(t.controller.getView()).toMatchObject({
      status: "idle",
      phaseIndex: 0,
      phaseElapsedMs: 0,
    });
  });

  it("start unlocks audio from the user gesture and keeps the screen awake", () => {
    t.controller.start();
    expect(t.cues.unlock).toHaveBeenCalledOnce();
    expect(t.screenAwake.acquire).toHaveBeenCalledOnce();
    expect(t.controller.getView().status).toBe("running");
  });

  it("plays each cue once as time advances", () => {
    t.controller.start();
    t.advanceTo(1_950);
    expect(t.cues.play).not.toHaveBeenCalled();
    t.advanceTo(2_050);
    t.advanceTo(2_150);
    expect(t.cues.play.mock.calls).toEqual([["tick"]]);
    t.advanceTo(5_000);
    expect(t.cues.play).toHaveBeenLastCalledWith("work");
  });

  it("reports the current phase and progress in the view", () => {
    t.controller.start();
    t.advanceTo(10_000);
    expect(t.controller.getView()).toMatchObject({
      phaseIndex: 1,
      phaseElapsedMs: 5_000,
      phaseRemainingMs: 15_000,
      positionMs: 10_000,
    });
  });

  it("does not advance or cue while paused, then resumes where it was", () => {
    t.controller.start();
    t.advanceTo(1_000);
    t.controller.pause();
    t.advanceTo(30_000);
    expect(t.controller.getView().positionMs).toBe(1_000);
    expect(t.cues.play).not.toHaveBeenCalled();
    expect(t.screenAwake.release).toHaveBeenCalledOnce();
    t.controller.resume();
    expect(t.screenAwake.acquire).toHaveBeenCalledTimes(2);
    t.advanceTo(31_000);
    expect(t.controller.getView().positionMs).toBe(2_000);
  });

  it("finishes, plays the finish cue and releases the screen", () => {
    t.controller.start();
    t.advanceTo(60_000);
    expect(t.controller.getView().status).toBe("finished");
    expect(t.cues.play).toHaveBeenLastCalledWith("finish");
    expect(t.screenAwake.release).toHaveBeenCalledOnce();
  });

  it("skip announces the phase it lands on", () => {
    t.controller.start();
    t.advanceTo(1_000);
    t.controller.skip();
    expect(t.controller.getView().phaseIndex).toBe(1);
    expect(t.cues.play).toHaveBeenLastCalledWith("work");
  });

  it("reset returns to idle, clears marks and allows starting again", () => {
    t.controller.start();
    t.advanceTo(3_000);
    t.controller.mark();
    t.controller.reset();
    expect(t.controller.getView()).toMatchObject({ status: "idle", positionMs: 0, marks: [] });
    expect(t.screenAwake.release).toHaveBeenCalledOnce();
    t.controller.start();
    expect(t.controller.getView().status).toBe("running");
  });

  it("notifies subscribers only until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = t.controller.subscribe(listener);
    t.controller.start();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    t.advanceTo(1_000);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps the same view between changes so React does not re-render needlessly", () => {
    expect(t.controller.getView()).toBe(t.controller.getView());
  });

  it("dispose releases the screen", () => {
    t.controller.start();
    t.controller.dispose();
    expect(t.screenAwake.release).toHaveBeenCalledOnce();
  });

  describe("with the voice on", () => {
    const voiceOn = { ...DEFAULT_SOUND_SETTINGS, voice: true };

    it("unlocks the voice from the user gesture, only when it is on", () => {
      const on = setup(timeline, voiceOn);
      on.controller.start();
      expect(on.voice.unlock).toHaveBeenCalledOnce();
      t.controller.start();
      expect(t.voice.unlock).not.toHaveBeenCalled();
    });

    it("says each announcement once, and only vibrates where the tone is replaced", () => {
      const on = setup(timeline, voiceOn);
      on.controller.start();
      expect(on.voice.say.mock.calls).toEqual([[{ kind: "phase", phase: "prepare" }]]);
      on.advanceTo(2_000);
      on.advanceTo(2_100);
      expect(on.voice.say).toHaveBeenCalledTimes(2);
      expect(on.voice.say).toHaveBeenLastCalledWith({ kind: "count", seconds: 3 });
      expect(on.cues.vibrate).toHaveBeenCalledWith("tick");
      expect(on.cues.play).not.toHaveBeenCalled();
    });

    it("goes back to tones for the rest of the workout once the voice cannot speak", () => {
      const on = setup(timeline, voiceOn);
      on.controller.start();
      on.voice.canSpeak.mockReturnValue(false);
      on.voice.say.mockClear();
      on.advanceTo(2_000);
      expect(on.cues.play).toHaveBeenLastCalledWith("tick");
      expect(on.voice.say).not.toHaveBeenCalled();
    });
  });

  it("makes no sound or speech for what is switched off, but still vibrates", () => {
    const quiet = setup(timeline, { ...DEFAULT_SOUND_SETTINGS, intervalSound: false });
    quiet.controller.start();
    quiet.advanceTo(5_000);
    expect(quiet.cues.play).not.toHaveBeenCalled();
    expect(quiet.cues.vibrate).toHaveBeenLastCalledWith("work");
    expect(quiet.voice.say).not.toHaveBeenCalled();
  });

  it("ending an open workout respects the settings too", () => {
    const open = buildTimeline({ ...defaultConfig("stopwatch"), prepareSeconds: 0 });
    const quiet = setup(open, { ...DEFAULT_SOUND_SETTINGS, voice: true, intervalSound: false });
    quiet.controller.start();
    quiet.voice.say.mockClear();
    quiet.controller.skip();
    expect(quiet.cues.play).not.toHaveBeenCalled();
    expect(quiet.cues.vibrate).toHaveBeenLastCalledWith("finish");
    expect(quiet.voice.say).toHaveBeenLastCalledWith({ kind: "finish" });
  });
});
