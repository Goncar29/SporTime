import { locate, type Phase, type Timeline } from "../../workouts/domain/timeline";
import { BEFORE_START, finishEvent, latestEvent, type CueEvent } from "../domain/cues";
import * as session from "../domain/session";
import type { Mark, Session, SessionStatus } from "../domain/session";
import { effectiveSound, type SoundSettings } from "../domain/soundSettings";
import type { Announcer, Clock, CuePlayer, ScreenAwake } from "./ports";

export interface TimerView {
  status: SessionStatus;
  phase: Phase;
  phaseIndex: number;
  phaseElapsedMs: number;
  phaseRemainingMs: number | null;
  positionMs: number;
  activeElapsedMs: number;
  marks: readonly Mark[];
}

export interface TimerController {
  getView(): TimerView;
  subscribe(listener: () => void): () => void;
  start(): void;
  pause(): void;
  resume(): void;
  skip(): void;
  mark(): void;
  reset(): void;
  tick(): void;
  dispose(): void;
}

interface Dependencies {
  timeline: Timeline;
  clock: Clock;
  cues: CuePlayer;
  voice: Announcer;
  sound: SoundSettings;
  screenAwake: ScreenAwake;
}

export function createTimerController({
  timeline,
  clock,
  cues,
  voice,
  sound,
  screenAwake,
}: Dependencies): TimerController {
  let current: Session = session.createSession();
  let lastPositionMs = BEFORE_START;
  let awake = false;
  const listeners = new Set<() => void>();

  const buildView = (): TimerView => {
    const now = clock.now();
    const positionMs = session.positionAt(current, now);
    const { index, phase, elapsedInPhaseMs, remainingInPhaseMs } = locate(timeline, positionMs);
    return {
      status: current.status,
      phase,
      phaseIndex: index,
      phaseElapsedMs: elapsedInPhaseMs,
      phaseRemainingMs: remainingInPhaseMs,
      positionMs,
      activeElapsedMs: session.activeElapsedMs(current, timeline, now),
      marks: current.marks,
    };
  };

  let view = buildView();

  const setAwake = (next: boolean) => {
    if (next === awake) return;
    awake = next;
    if (next) screenAwake.acquire();
    else screenAwake.release();
  };

  const perform = ({ cue, tone, announcement }: CueEvent) => {
    if (cue && tone) cues.play(cue);
    else if (cue) cues.vibrate(cue);
    if (announcement) voice.say(announcement);
  };

  const unlockSound = () => {
    cues.unlock();
    if (sound.voice) voice.unlock();
  };

  /** Applies a transition, then derives every side effect from the new state. */
  const commit = (next: Session) => {
    const wasFinished = current.status === "finished";
    current = session.settle(next, timeline, clock.now());

    const positionMs = session.positionAt(current, clock.now());
    const active = effectiveSound(sound, () => voice.canSpeak());
    const event = latestEvent(timeline, lastPositionMs, positionMs, active);
    if (event) perform(event);
    else if (current.status === "finished" && !wasFinished) perform(finishEvent(active));
    lastPositionMs = positionMs;

    setAwake(current.status === "running");
    view = buildView();
    listeners.forEach((listener) => {
      listener();
    });
  };

  return {
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      unlockSound();
      commit(session.start(current, clock.now()));
    },
    pause() {
      commit(session.pause(current, clock.now()));
    },
    resume() {
      unlockSound();
      commit(session.resume(current, clock.now()));
    },
    skip() {
      commit(session.skip(current, timeline, clock.now()));
    },
    mark() {
      commit(session.addMark(current, timeline, clock.now()));
    },
    reset() {
      current = session.createSession();
      lastPositionMs = BEFORE_START;
      setAwake(false);
      view = buildView();
      listeners.forEach((listener) => {
        listener();
      });
    },
    tick() {
      if (current.status === "running") commit(current);
    },
    dispose() {
      setAwake(false);
      listeners.clear();
    },
  };
}
