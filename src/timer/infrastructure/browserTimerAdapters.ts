import type { Cue } from "../domain/cues";
import type { Clock, CuePlayer, ScreenAwake } from "../application/ports";

/** Date.now keeps advancing while a device sleeps, unlike some monotonic clocks. */
export const systemClock: Clock = { now: () => Date.now() };

interface Tone {
  frequency: number;
  delay: number;
  duration: number;
}

const TONES: Record<Cue, readonly Tone[]> = {
  tick: [{ frequency: 880, delay: 0, duration: 0.12 }],
  work: [
    { frequency: 988, delay: 0, duration: 0.12 },
    { frequency: 1319, delay: 0.14, duration: 0.3 },
  ],
  rest: [{ frequency: 523, delay: 0, duration: 0.4 }],
  finish: [
    { frequency: 784, delay: 0, duration: 0.16 },
    { frequency: 988, delay: 0.18, duration: 0.16 },
    { frequency: 1319, delay: 0.36, duration: 0.5 },
  ],
};

const VIBRATION: Record<Cue, number | number[]> = {
  tick: 40,
  work: [120, 60, 120],
  rest: 250,
  finish: [200, 80, 200, 80, 400],
};

export function createWebAudioCuePlayer(): CuePlayer {
  let context: AudioContext | null = null;

  const playTone = (audio: AudioContext, { frequency, delay, duration }: Tone) => {
    const startAt = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.25, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
  };

  return {
    unlock() {
      context ??= new AudioContext();
      void context.resume();
    },
    play(cue) {
      navigator.vibrate?.(VIBRATION[cue]);
      if (!context) return;
      // Mobile browsers suspend audio after interruptions such as a phone call.
      if (context.state !== "running") void context.resume();
      for (const tone of TONES[cue]) playTone(context, tone);
    },
  };
}

export function createWakeLockScreenAwake(): ScreenAwake {
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;

  const request = async () => {
    if (!("wakeLock" in navigator) || sentinel) return;
    try {
      const acquired = await navigator.wakeLock.request("screen");
      if (wanted) sentinel = acquired;
      else await acquired.release();
    } catch {
      // Denied or unsupported: the timer still works, the screen may just dim.
    }
  };

  // Browsers drop the lock when the page is hidden, so take it again on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wanted) {
      sentinel = null;
      void request();
    }
  });

  return {
    acquire() {
      wanted = true;
      void request();
    },
    release() {
      wanted = false;
      void sentinel?.release();
      sentinel = null;
    },
  };
}
