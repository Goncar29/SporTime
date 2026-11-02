import type { WorkoutConfig } from "./workout";

export type PhaseKind = "prepare" | "work" | "rest" | "setRest";

export interface Phase {
  kind: PhaseKind;
  startMs: number;
  /** `null` means the phase is open-ended and only stops when the user ends it. */
  durationMs: number | null;
  display: "countdown" | "countup";
  round: number;
  totalRounds: number;
  set: number;
  totalSets: number;
}

export interface Timeline {
  phases: readonly Phase[];
  /** `null` when the timeline contains an open-ended phase. */
  totalMs: number | null;
}

export interface PhaseLocation {
  index: number;
  phase: Phase;
  elapsedInPhaseMs: number;
  remainingInPhaseMs: number | null;
}

const toMs = (seconds: number) => seconds * 1_000;

/** Every workout mode reduces to this one sequence of phases. */
export function buildTimeline(config: WorkoutConfig): Timeline {
  const { mode, rounds, sets } = config;
  const phases: Phase[] = [];
  let cursor = 0;

  const add = (
    kind: PhaseKind,
    durationMs: number | null,
    display: Phase["display"],
    round: number,
    set: number,
    totalRounds: number,
    totalSets: number,
  ) => {
    phases.push({ kind, startMs: cursor, durationMs, display, round, totalRounds, set, totalSets });
    cursor += durationMs ?? 0;
  };

  const totalSets = mode === "stopwatch" ? 1 : sets;

  if (config.prepareSeconds > 0) {
    add("prepare", toMs(config.prepareSeconds), "countdown", 1, 1, rounds, totalSets);
  }

  if (mode === "stopwatch") {
    add("work", null, "countup", 1, 1, 1, 1);
    return { phases, totalMs: null };
  }

  const workDisplay = mode === "forTime" ? "countup" : "countdown";
  for (let set = 1; set <= sets; set += 1) {
    for (let round = 1; round <= rounds; round += 1) {
      add("work", toMs(config.workSeconds), workDisplay, round, set, rounds, sets);
      if (round < rounds && config.restSeconds > 0) {
        add("rest", toMs(config.restSeconds), "countdown", round, set, rounds, sets);
      }
    }
    if (set < sets && config.setRestSeconds > 0) {
      add("setRest", toMs(config.setRestSeconds), "countdown", rounds, set, rounds, sets);
    }
  }

  return { phases, totalMs: cursor };
}

export function locate(timeline: Timeline, positionMs: number): PhaseLocation {
  const { phases } = timeline;
  let index = phases.length - 1;
  while (index > 0 && phases[index]!.startMs > positionMs) index -= 1;

  const phase = phases[index]!;
  const elapsedInPhaseMs = positionMs - phase.startMs;
  if (phase.durationMs === null) {
    return { index, phase, elapsedInPhaseMs, remainingInPhaseMs: null };
  }
  const clampedElapsed = Math.min(elapsedInPhaseMs, phase.durationMs);
  return {
    index,
    phase,
    elapsedInPhaseMs: clampedElapsed,
    remainingInPhaseMs: phase.durationMs - clampedElapsed,
  };
}
