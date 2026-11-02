import { locate, type Timeline } from "../../workouts/domain/timeline";

export type SessionStatus = "idle" | "running" | "paused" | "finished";

export interface Mark {
  phaseIndex: number;
  phaseElapsedMs: number;
}

export interface Session {
  status: SessionStatus;
  /** Position in the timeline when `anchorAt` was taken. */
  positionMs: number;
  /** Wall-clock time position is measured from while running. */
  anchorAt: number | null;
  /** Workout time jumped over by skipping, which never counts as time trained. */
  skippedMs: number;
  marks: readonly Mark[];
}

export function createSession(): Session {
  return { status: "idle", positionMs: 0, anchorAt: null, skippedMs: 0, marks: [] };
}

/**
 * Derived from the wall clock rather than accumulated per tick, so timers the
 * browser throttles or suspends cannot make the workout drift.
 */
export function positionAt(session: Session, now: number): number {
  return session.anchorAt === null
    ? session.positionMs
    : session.positionMs + (now - session.anchorAt);
}

export function start(session: Session, now: number): Session {
  if (session.status !== "idle") return session;
  return { ...session, status: "running", anchorAt: now };
}

export function pause(session: Session, now: number): Session {
  if (session.status !== "running") return session;
  return { ...session, status: "paused", positionMs: positionAt(session, now), anchorAt: null };
}

export function resume(session: Session, now: number): Session {
  if (session.status !== "paused") return session;
  return { ...session, status: "running", anchorAt: now };
}

export function settle(session: Session, timeline: Timeline, now: number): Session {
  if (session.status !== "running" || timeline.totalMs === null) return session;
  if (positionAt(session, now) < timeline.totalMs) return session;
  return { ...session, status: "finished", positionMs: timeline.totalMs, anchorAt: null };
}

export function skip(session: Session, timeline: Timeline, now: number): Session {
  if (session.status !== "running" && session.status !== "paused") return session;

  const position = positionAt(session, now);
  const { index, phase, elapsedInPhaseMs } = locate(timeline, position);
  const next = timeline.phases[index + 1];

  if (!next && phase.durationMs === null) {
    return { ...session, status: "finished", positionMs: position, anchorAt: null };
  }

  const target = next ? next.startMs : (timeline.totalMs ?? position);
  const finishedEarly = phase.display === "countup";
  const marks = finishedEarly
    ? [...session.marks, { phaseIndex: index, phaseElapsedMs: elapsedInPhaseMs }]
    : session.marks;
  const skippedMs = session.skippedMs + (phase.kind === "prepare" ? 0 : target - position);

  if (!next) {
    return { ...session, status: "finished", positionMs: target, anchorAt: null, skippedMs, marks };
  }
  return {
    ...session,
    positionMs: target,
    anchorAt: session.status === "running" ? now : null,
    skippedMs,
    marks,
  };
}

export function addMark(session: Session, timeline: Timeline, now: number): Session {
  if (session.status !== "running") return session;
  const { index, elapsedInPhaseMs } = locate(timeline, positionAt(session, now));
  return {
    ...session,
    marks: [...session.marks, { phaseIndex: index, phaseElapsedMs: elapsedInPhaseMs }],
  };
}

/** Time actually trained: excludes the prepare phase and anything skipped. */
export function activeElapsedMs(session: Session, timeline: Timeline, now: number): number {
  const first = timeline.phases[0];
  const prepareMs = first?.kind === "prepare" ? (first.durationMs ?? 0) : 0;
  return Math.max(0, positionAt(session, now) - prepareMs - session.skippedMs);
}
