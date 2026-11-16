import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createAccountLock } from "./accountLock";
import { createFakeLockManager } from "./fakeLockManager";

/** Work the test finishes by hand, recording when it starts and ends. */
function step(log: string[], name: string) {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const work = vi.fn(async () => {
    log.push(`${name}:start`);
    await done;
    log.push(`${name}:end`);
    return name;
  });
  return { work, finish };
}

/** Lets every queued promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("account lock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets several shared holders run together", async () => {
    const log: string[] = [];
    const lock = createAccountLock("u1", createFakeLockManager());
    const first = step(log, "a");
    const second = step(log, "b");
    const results = [lock.shared(first.work), lock.shared(second.work)];
    await settle();
    expect(log).toEqual(["a:start", "b:start"]);
    first.finish();
    second.finish();
    await expect(Promise.all(results)).resolves.toEqual(["a", "b"]);
  });

  it("runs an exclusive holder alone, after the shared ones that came first, and before later ones", async () => {
    const log: string[] = [];
    const lock = createAccountLock("u1", createFakeLockManager());
    const before = step(log, "before");
    const exclusive = step(log, "exclusive");
    const after = step(log, "after");
    const done = [
      lock.shared(before.work),
      lock.exclusive(exclusive.work, 10_000),
      lock.shared(after.work),
    ];
    await settle();
    expect(log).toEqual(["before:start"]);

    before.finish();
    await settle();
    expect(log).toEqual(["before:start", "before:end", "exclusive:start"]);

    exclusive.finish();
    await settle();
    expect(log).toEqual([
      "before:start",
      "before:end",
      "exclusive:start",
      "exclusive:end",
      "after:start",
    ]);
    after.finish();
    await expect(Promise.all(done)).resolves.toEqual(["before", { value: "exclusive" }, "after"]);
  });

  it("is per account: another account's holder does not wait", async () => {
    const log: string[] = [];
    const locks = createFakeLockManager();
    const held = step(log, "u1");
    void createAccountLock("u1", locks).exclusive(held.work, 10_000);
    await settle();
    const other = step(log, "u2");
    void createAccountLock("u2", locks).shared(other.work);
    await settle();
    expect(log).toEqual(["u1:start", "u2:start"]);
  });

  it("gives up on the exclusive lock when it is not free in time, and never runs the work", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const lock = createAccountLock("u1", createFakeLockManager());
    const holder = step(log, "holder");
    void lock.shared(holder.work);
    const waiting = step(log, "waiting");
    const result = lock.exclusive(waiting.work, 10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
    holder.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.work).not.toHaveBeenCalled();
    // Gave up its place, so later holders are not held up by it.
    const later = step(log, "later");
    void lock.shared(later.work);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toContain("later:start");
  });

  it("passes on what the work throws, once it holds the lock", async () => {
    const lock = createAccountLock("u1", createFakeLockManager());
    await expect(lock.exclusive(() => Promise.reject(new Error("boom")), 10_000)).rejects.toThrow(
      "boom",
    );
    await expect(lock.shared(() => Promise.reject(new Error("bang")))).rejects.toThrow("bang");
  });

  describe("without Web Locks in the browser", () => {
    it("just runs the work, shared or exclusive, with nothing to wait for", async () => {
      const log: string[] = [];
      const lock = createAccountLock("u1", undefined);
      expect(lock.available).toBe(false);
      const held = step(log, "shared");
      void lock.shared(held.work);
      const exclusive = step(log, "exclusive");
      const result = lock.exclusive(exclusive.work, 10_000);
      await settle();
      expect(log).toEqual(["shared:start", "exclusive:start"]);
      exclusive.finish();
      await expect(result).resolves.toEqual({ value: "exclusive" });
    });
  });
});
