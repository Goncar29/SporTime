import { describe, expect, it } from "vite-plus/test";
import { buildTimeline } from "../../workouts/domain/timeline";
import { defaultConfig } from "../../workouts/domain/workout";
import {
  activeElapsedMs,
  addMark,
  createSession,
  pause,
  positionAt,
  resume,
  settle,
  skip,
  start,
} from "./session";

const tabata = buildTimeline({ ...defaultConfig("tabata"), prepareSeconds: 10, rounds: 2 });
const stopwatch = buildTimeline({ ...defaultConfig("stopwatch"), prepareSeconds: 0 });
const forTime = buildTimeline({
  ...defaultConfig("forTime"),
  prepareSeconds: 0,
  workSeconds: 600,
  sets: 2,
  setRestSeconds: 60,
});

describe("session clock", () => {
  it("position follows wall-clock time, not the number of ticks", () => {
    const session = start(createSession(), 1_000);
    expect(positionAt(session, 1_000)).toBe(0);
    expect(positionAt(session, 61_000)).toBe(60_000);
  });

  it("pausing freezes the position and resuming continues from it", () => {
    const paused = pause(start(createSession(), 0), 5_000);
    expect(paused.status).toBe("paused");
    expect(positionAt(paused, 100_000)).toBe(5_000);
    const resumed = resume(paused, 100_000);
    expect(positionAt(resumed, 101_000)).toBe(6_000);
  });

  it("pausing or resuming in the wrong state changes nothing", () => {
    const idle = createSession();
    expect(pause(idle, 10)).toBe(idle);
    const running = start(idle, 0);
    expect(resume(running, 10)).toBe(running);
  });
});

describe("settle", () => {
  it("finishes exactly at the total when the time runs out", () => {
    const settled = settle(start(createSession(), 0), tabata, 500_000);
    expect(settled.status).toBe("finished");
    expect(positionAt(settled, 900_000)).toBe(tabata.totalMs);
  });

  it("keeps running before the end, and forever when open-ended", () => {
    const running = start(createSession(), 0);
    expect(settle(running, tabata, 1_000).status).toBe("running");
    expect(settle(running, stopwatch, 99_999_999).status).toBe("running");
  });
});

describe("skip", () => {
  it("jumps to the start of the next phase", () => {
    const skipped = skip(start(createSession(), 0), tabata, 12_000);
    expect(positionAt(skipped, 12_000)).toBe(30_000);
  });

  it("works while paused and stays paused", () => {
    const skipped = skip(pause(start(createSession(), 0), 12_000), tabata, 50_000);
    expect(skipped.status).toBe("paused");
    expect(positionAt(skipped, 60_000)).toBe(30_000);
  });

  it("finishes when skipping the last phase", () => {
    const skipped = skip(start(createSession(), 0), tabata, 45_000);
    expect(skipped.status).toBe("finished");
    expect(skipped.positionMs).toBe(tabata.totalMs);
  });

  it("finishing a stopwatch keeps the time reached", () => {
    const finished = skip(start(createSession(), 0), stopwatch, 42_500);
    expect(finished.status).toBe("finished");
    expect(positionAt(finished, 90_000)).toBe(42_500);
    expect(activeElapsedMs(finished, stopwatch, 90_000)).toBe(42_500);
  });

  it("finishing a count-up phase early records the time as a mark", () => {
    const finishedSet = skip(start(createSession(), 0), forTime, 245_000);
    expect(finishedSet.marks).toEqual([{ phaseIndex: 0, phaseElapsedMs: 245_000 }]);
    expect(positionAt(finishedSet, 245_000)).toBe(600_000);
  });

  it("skipping a countdown phase records no mark", () => {
    expect(skip(start(createSession(), 0), tabata, 12_000).marks).toEqual([]);
  });
});

describe("addMark", () => {
  it("records the elapsed time of the current phase", () => {
    const marked = addMark(start(createSession(), 0), stopwatch, 3_000);
    expect(addMark(marked, stopwatch, 7_000).marks).toEqual([
      { phaseIndex: 0, phaseElapsedMs: 3_000 },
      { phaseIndex: 0, phaseElapsedMs: 7_000 },
    ]);
  });

  it("ignores marks unless running", () => {
    const idle = createSession();
    expect(addMark(idle, stopwatch, 10)).toBe(idle);
  });
});

describe("activeElapsedMs", () => {
  it("does not count the prepare phase", () => {
    const session = start(createSession(), 0);
    expect(activeElapsedMs(session, tabata, 5_000)).toBe(0);
    expect(activeElapsedMs(session, tabata, 15_000)).toBe(5_000);
  });

  it("does not count time skipped during the workout", () => {
    const skipped = skip(start(createSession(), 0), tabata, 12_000);
    expect(activeElapsedMs(skipped, tabata, 12_000)).toBe(2_000);
  });

  it("skipping the prepare phase does not reduce the workout time", () => {
    const skipped = skip(start(createSession(), 0), tabata, 4_000);
    expect(activeElapsedMs(skipped, tabata, 7_000)).toBe(3_000);
  });
});
