import type { Cue } from "../domain/cues";

export interface Clock {
  now(): number;
}

export interface CuePlayer {
  /** Must be called from a user gesture: browsers block audio otherwise. */
  unlock(): void;
  play(cue: Cue): void;
}

export interface ScreenAwake {
  acquire(): void;
  release(): void;
}
