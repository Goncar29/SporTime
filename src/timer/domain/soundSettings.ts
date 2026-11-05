export interface SoundSettings {
  /** Master switch for everything spoken. */
  voice: boolean;
  /** Said by the voice when it is on, and a tone otherwise. */
  countdown: boolean;
  tenSecondsLeft: boolean;
  halfway: boolean;
  intervalName: boolean;
  /** The tones played when a phase changes and at the finish. */
  intervalSound: boolean;
}

export const SOUND_SETTINGS_KEYS = [
  "voice",
  "countdown",
  "tenSecondsLeft",
  "halfway",
  "intervalName",
  "intervalSound",
] as const satisfies readonly (keyof SoundSettings)[];

/** With the voice off, these are exactly the sounds the app always made. */
export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  voice: false,
  countdown: true,
  tenSecondsLeft: true,
  halfway: true,
  intervalName: true,
  intervalSound: true,
};

/** Anything unreadable falls back to its default, because a setting must never break the timer. */
export function parseSoundSettings(stored: string | null): SoundSettings {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stored ?? "null");
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SOUND_SETTINGS;
  const values = parsed as Record<string, unknown>;
  const settings = { ...DEFAULT_SOUND_SETTINGS };
  for (const key of SOUND_SETTINGS_KEYS) {
    const value = values[key];
    if (typeof value === "boolean") settings[key] = value;
  }
  return settings;
}

/** A voice that cannot speak gives way to tones, so a phase change is never silent by accident. */
export function effectiveSound(sound: SoundSettings, canSpeak: () => boolean): SoundSettings {
  if (!sound.voice || canSpeak()) return sound;
  return { ...sound, voice: false, intervalSound: sound.intervalSound || sound.intervalName };
}
