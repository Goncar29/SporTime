import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_SOUND_SETTINGS, effectiveSound, parseSoundSettings } from "./soundSettings";

describe("parseSoundSettings", () => {
  it("starts with the voice off and every sound the app always had", () => {
    expect(parseSoundSettings(null)).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(DEFAULT_SOUND_SETTINGS.voice).toBe(false);
    expect(DEFAULT_SOUND_SETTINGS.countdown).toBe(true);
    expect(DEFAULT_SOUND_SETTINGS.intervalSound).toBe(true);
  });

  it("keeps stored choices and fills in anything missing", () => {
    expect(parseSoundSettings('{"voice":true,"halfway":false}')).toEqual({
      ...DEFAULT_SOUND_SETTINGS,
      voice: true,
      halfway: false,
    });
  });

  it("ignores unreadable or wrongly typed values", () => {
    expect(parseSoundSettings("not json")).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(parseSoundSettings("[1]")).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(parseSoundSettings('{"voice":"yes","other":true}')).toEqual(DEFAULT_SOUND_SETTINGS);
  });
});

describe("effectiveSound", () => {
  const voiceOnly = { ...DEFAULT_SOUND_SETTINGS, voice: true, intervalSound: false };

  it("changes nothing while the voice works", () => {
    expect(effectiveSound(voiceOnly, () => true)).toEqual(voiceOnly);
  });

  it("falls back to tones when the voice cannot speak, so changes are never silent", () => {
    expect(effectiveSound(voiceOnly, () => false)).toEqual({
      ...voiceOnly,
      voice: false,
      intervalSound: true,
    });
  });

  it("respects interval names being off when falling back", () => {
    const quiet = { ...voiceOnly, intervalName: false };
    expect(effectiveSound(quiet, () => false).intervalSound).toBe(false);
  });

  it("does not ask the voice when it is off", () => {
    const off = { ...DEFAULT_SOUND_SETTINGS, voice: false };
    expect(
      effectiveSound(off, () => {
        throw new Error("asked");
      }),
    ).toEqual(off);
  });
});
