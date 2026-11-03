import { describe, expect, it, vi } from "vite-plus/test";
import { createTimerController } from "../../timer/application/timerController";
import { buildTimeline } from "../../workouts/domain/timeline";
import { defaultConfig } from "../../workouts/domain/workout";
import { recordFinishedSessions } from "./recordFinishedSessions";

function setup(add = vi.fn(() => Promise.resolve())) {
  let now = 1_000;
  const clock = { now: () => now };
  const config = { ...defaultConfig("amrap"), prepareSeconds: 0, workSeconds: 10 };
  const controller = createTimerController({
    timeline: buildTimeline(config),
    clock,
    cues: { unlock: vi.fn(), play: vi.fn() },
    screenAwake: { acquire: vi.fn(), release: vi.fn() },
  });
  const onFailure = vi.fn();
  recordFinishedSessions({ controller, config, log: { add }, clock, onFailure });
  return {
    add,
    config,
    controller,
    onFailure,
    advance(ms: number) {
      now += ms;
      controller.tick();
    },
  };
}

describe("recordFinishedSessions", () => {
  it("saves nothing while the workout is unfinished", () => {
    const { add, controller, advance } = setup();
    controller.start();
    advance(5_000);
    controller.pause();
    controller.dispose();
    expect(add).not.toHaveBeenCalled();
  });

  it("saves a finished workout once, with what was trained", () => {
    const { add, config, controller, advance } = setup();
    controller.start();
    advance(2_000);
    controller.mark();
    advance(8_000);
    advance(500);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({
      config,
      finishedAt: 11_000,
      activeMs: 10_000,
      marks: 1,
    });
  });

  it("does not save again when the finished timer notifies again", () => {
    const { add, controller, advance } = setup();
    controller.start();
    advance(10_000);
    controller.pause();
    controller.skip();
    controller.tick();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("saves each repeat of the workout", () => {
    const { add, controller, advance } = setup();
    controller.start();
    advance(10_000);
    controller.reset();
    controller.start();
    advance(10_000);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("reports a save that fails", async () => {
    const { controller, advance, onFailure } = setup(vi.fn(() => Promise.reject(new Error("no"))));
    controller.start();
    advance(10_000);
    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledTimes(1);
    });
  });
});
