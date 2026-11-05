import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createSystemVoice } from "./browserTimerAdapters";

class FakeUtterance {
  lang = "";
  voice: unknown = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

function fakeSynthesis(voices = [{ lang: "en-US" }, { lang: "es-419" }]) {
  return { getVoices: vi.fn(() => voices), speak: vi.fn(), cancel: vi.fn() };
}

const spoken = (synthesis: ReturnType<typeof fakeSynthesis>) =>
  synthesis.speak.mock.lastCall?.[0] as unknown as FakeUtterance;

describe("createSystemVoice", () => {
  beforeEach(() => {
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cannot speak in a browser without speech", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    const voice = createSystemVoice();
    expect(voice.canSpeak("en")).toBe(false);
    expect(() => {
      voice.unlock();
      voice.say("3", "en");
    }).not.toThrow();
  });

  it("can speak only a language this device has a voice for", () => {
    vi.stubGlobal("speechSynthesis", fakeSynthesis([{ lang: "en-US" }]));
    const voice = createSystemVoice();
    expect(voice.canSpeak("en")).toBe(true);
    expect(voice.canSpeak("es")).toBe(false);
  });

  it("speaks in the requested language with a matching voice, dropping anything older", () => {
    const synthesis = fakeSynthesis();
    vi.stubGlobal("speechSynthesis", synthesis);
    createSystemVoice().say("Trabajo", "es");
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(spoken(synthesis)).toMatchObject({
      text: "Trabajo",
      lang: "es",
      voice: { lang: "es-419" },
    });
  });

  it("stops offering speech after a real failure, but not after replacing a phrase", () => {
    const synthesis = fakeSynthesis();
    vi.stubGlobal("speechSynthesis", synthesis);
    const voice = createSystemVoice();
    voice.say("3", "en");
    spoken(synthesis).onerror?.({ error: "interrupted" });
    spoken(synthesis).onerror?.({ error: "canceled" });
    expect(voice.canSpeak("en")).toBe(true);
    spoken(synthesis).onerror?.({ error: "synthesis-unavailable" });
    expect(voice.canSpeak("en")).toBe(false);
  });

  it("unlocks by speaking nothing, which browsers require from a user gesture", () => {
    const synthesis = fakeSynthesis();
    vi.stubGlobal("speechSynthesis", synthesis);
    createSystemVoice().unlock();
    expect(spoken(synthesis).text).toBe("");
  });
});
