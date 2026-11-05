import type { Announcement, Cue } from "../domain/cues";
import type { SoundSettings } from "../domain/soundSettings";

export interface Clock {
  now(): number;
}

export interface CuePlayer {
  /** Must be called from a user gesture: browsers block audio otherwise. */
  unlock(): void;
  play(cue: Cue): void;
  /** For a cue whose tone is switched off or replaced by the voice. */
  vibrate(cue: Cue): void;
}

/** What the timer needs from a voice, in the terms of a workout. */
export interface Announcer {
  /** Must be called from a user gesture: browsers block speech otherwise. */
  unlock(): void;
  /** May turn false during a workout, when the device's voice fails. */
  canSpeak(): boolean;
  say(announcement: Announcement): void;
}

export interface VoicePlayer {
  unlock(): void;
  canSpeak(language: string): boolean;
  say(text: string, language: string): void;
}

export interface SoundSettingsStore {
  get(): string | null;
  set(settings: SoundSettings): void;
}

export interface ScreenAwake {
  acquire(): void;
  release(): void;
}
