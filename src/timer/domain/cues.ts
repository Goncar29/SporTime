import type { Timeline } from "../../workouts/domain/timeline";

export type Cue = "tick" | "work" | "rest" | "finish";

/** Lets the very first position (0) count as crossed when a workout starts. */
export const BEFORE_START = -1;

const COUNTDOWN_SECONDS = [3, 2, 1];

/**
 * Returns the most recent cue point in `(fromMs, toMs]`. Comparing positions
 * means cues survive throttled timers, and only the latest one plays after a
 * long gap instead of a burst of stale sounds.
 */
export function latestCue(timeline: Timeline, fromMs: number, toMs: number): Cue | null {
  let latest: { at: number; cue: Cue } | null = null;

  const consider = (at: number, cue: Cue) => {
    if (at > fromMs && at <= toMs && (latest === null || at > latest.at)) latest = { at, cue };
  };

  for (const phase of timeline.phases) {
    if (phase.kind === "work") consider(phase.startMs, "work");
    if (phase.kind === "rest" || phase.kind === "setRest") consider(phase.startMs, "rest");
    if (phase.durationMs === null) continue;

    const endMs = phase.startMs + phase.durationMs;
    for (const seconds of COUNTDOWN_SECONDS) {
      const at = endMs - seconds * 1_000;
      if (at > phase.startMs) consider(at, "tick");
    }
  }

  if (timeline.totalMs !== null) consider(timeline.totalMs, "finish");

  return (latest as { at: number; cue: Cue } | null)?.cue ?? null;
}
