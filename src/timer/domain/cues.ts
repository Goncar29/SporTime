import type { Phase, PhaseKind, Timeline } from "../../workouts/domain/timeline";
import type { SoundSettings } from "./soundSettings";

export type Cue = "tick" | "work" | "rest" | "finish";

export type Announcement =
  /** `name` is the round's own name, said instead of the phase's default name. */
  | { kind: "phase"; phase: PhaseKind; name?: string }
  | { kind: "count"; seconds: number }
  | { kind: "tenSecondsLeft" }
  | { kind: "halfway" }
  | { kind: "finish" };

export interface CueEvent {
  /** Decides the vibration, and the tone when `tone` is true. */
  cue: Cue | null;
  tone: boolean;
  announcement: Announcement | null;
}

/** Lets the very first position (0) count as crossed when a workout starts. */
export const BEFORE_START = -1;

const COUNTDOWN_SECONDS = [3, 2, 1];
const TEN_SECONDS_MS = 10_000;

const spoken = (announcement: Announcement): CueEvent => ({
  cue: null,
  tone: false,
  announcement,
});

function phaseStart(phase: Phase, sound: SoundSettings): CueEvent | null {
  const cue = phase.kind === "work" ? "work" : phase.kind === "prepare" ? null : "rest";
  const announcement: Announcement | null =
    sound.voice && sound.intervalName
      ? { kind: "phase", phase: phase.kind, ...(phase.name ? { name: phase.name } : {}) }
      : null;
  if (!cue && !announcement) return null;
  return { cue, tone: cue !== null && sound.intervalSound, announcement };
}

const countdownStep = (seconds: number, sound: SoundSettings): CueEvent =>
  sound.voice
    ? { cue: "tick", tone: false, announcement: { kind: "count", seconds } }
    : { cue: "tick", tone: true, announcement: null };

export const finishEvent = (sound: SoundSettings): CueEvent => ({
  cue: "finish",
  tone: sound.intervalSound,
  announcement: sound.voice && sound.intervalName ? { kind: "finish" } : null,
});

/**
 * Returns the most recent enabled event in `(fromMs, toMs]`. Comparing positions
 * means cues survive throttled timers, and only the latest one plays after a
 * long gap instead of a burst of stale sounds. When events share a moment the
 * first one considered wins, which is why switched-off events are never considered.
 */
export function latestEvent(
  timeline: Timeline,
  fromMs: number,
  toMs: number,
  sound: SoundSettings,
): CueEvent | null {
  let latest: { at: number; event: CueEvent } | null = null;

  const consider = (at: number, event: CueEvent | null) => {
    if (event && at > fromMs && at <= toMs && (latest === null || at > latest.at)) {
      latest = { at, event };
    }
  };

  for (const phase of timeline.phases) {
    consider(phase.startMs, phaseStart(phase, sound));
    if (phase.durationMs === null) continue;

    const endMs = phase.startMs + phase.durationMs;
    if (sound.countdown) {
      for (const seconds of COUNTDOWN_SECONDS) {
        const at = endMs - seconds * 1_000;
        if (at > phase.startMs) consider(at, countdownStep(seconds, sound));
      }
    }

    // Getting ready is not an interval worth pacing.
    if (!sound.voice || phase.kind === "prepare") continue;
    if (sound.tenSecondsLeft && endMs - TEN_SECONDS_MS > phase.startMs) {
      consider(endMs - TEN_SECONDS_MS, spoken({ kind: "tenSecondsLeft" }));
    }
    if (sound.halfway) consider(phase.startMs + phase.durationMs / 2, spoken({ kind: "halfway" }));
  }

  if (timeline.totalMs !== null) consider(timeline.totalMs, finishEvent(sound));

  return (latest as { at: number; event: CueEvent } | null)?.event ?? null;
}
