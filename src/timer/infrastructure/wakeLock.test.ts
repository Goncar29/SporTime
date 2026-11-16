import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createWakeLockScreenAwake } from "./browserTimerAdapters";

interface FakeSentinel {
  released: boolean;
  release: () => Promise<void>;
}

/** A wake lock whose requests resolve only when the test grants them. */
function fakeWakeLock() {
  const sentinels: FakeSentinel[] = [];
  const pending: (() => void)[] = [];
  const request = vi.fn(
    () =>
      new Promise<FakeSentinel>((resolve) => {
        pending.push(() => {
          const sentinel: FakeSentinel = {
            released: false,
            release: () => {
              sentinel.released = true;
              return Promise.resolve();
            },
          };
          sentinels.push(sentinel);
          resolve(sentinel);
        });
      }),
  );
  return {
    wakeLock: { request },
    sentinels,
    async grantAll() {
      pending.splice(0).forEach((grant) => {
        grant();
      });
      // Let the adapter's awaits after each grant run.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    held: () => sentinels.filter(({ released }) => !released).length,
  };
}

describe("createWakeLockScreenAwake", () => {
  let lock: ReturnType<typeof fakeWakeLock>;
  beforeEach(() => {
    lock = fakeWakeLock();
    vi.stubGlobal("navigator", { wakeLock: lock.wakeLock });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("holds the screen while acquired and lets it go on release", async () => {
    const screen = createWakeLockScreenAwake();
    screen.acquire();
    await lock.grantAll();
    expect(lock.held()).toBe(1);
    screen.release();
    expect(lock.held()).toBe(0);
  });

  it("lets go of a lock granted after the workout already released it", async () => {
    const screen = createWakeLockScreenAwake();
    screen.acquire();
    screen.release();
    await lock.grantAll();
    expect(lock.sentinels).toHaveLength(1);
    expect(lock.held()).toBe(0);
  });

  it("never leaves the screen awake after a quick pause and resume", async () => {
    const screen = createWakeLockScreenAwake();
    screen.acquire();
    screen.release();
    screen.acquire();
    await lock.grantAll();
    expect(lock.held()).toBe(1);
    screen.release();
    expect(lock.held()).toBe(0);
  });
});
