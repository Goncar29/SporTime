import type { Locks, LockMode } from "./accountLock";

interface Request {
  name: string;
  mode: LockMode;
  run: () => void;
}

interface Held {
  name: string;
  mode: LockMode;
  /** Tells the holder its lock was taken from it. */
  taken: () => void;
}

const aborted = () => new DOMException("The lock request was aborted", "AbortError");

/**
 * The part of the browser's Web Locks that the app uses, for tests: jsdom has none. Requests for
 * one name are granted in the order they were made; shared ones run together, an exclusive one
 * runs alone. A request that steals is granted at once, and the holders it took the lock from
 * are rejected while their work goes on, as in the browser. Like the browser, every tab of the
 * app shares one, so tests give both tabs the same.
 */
export function createFakeLockManager(): Locks {
  const queue: Request[] = [];
  const held: Held[] = [];

  const release = (lock: Held) => {
    const index = held.indexOf(lock);
    if (index !== -1) held.splice(index, 1);
  };

  const grantWhatCan = (name: string) => {
    for (const request of queue.filter((item) => item.name === name)) {
      const holders = held.filter((item) => item.name === name);
      const free =
        request.mode === "exclusive"
          ? holders.length === 0
          : holders.every((item) => item.mode === "shared");
      // A request never jumps an earlier one still waiting.
      if (!free) return;
      queue.splice(queue.indexOf(request), 1);
      request.run();
    }
  };

  return {
    request(name, { mode, signal, steal = false }, callback) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(aborted());
          return;
        }
        const request: Request = {
          name,
          mode,
          run() {
            const lock: Held = {
              name,
              mode,
              taken: () => {
                reject(aborted());
              },
            };
            held.push(lock);
            void Promise.resolve()
              .then(callback)
              .then(resolve, reject)
              .finally(() => {
                // A lock taken from it was let go already, and must not be twice.
                if (!held.includes(lock)) return;
                release(lock);
                grantWhatCan(name);
              });
          },
        };
        if (steal) {
          held
            .filter((item) => item.name === name)
            .forEach((item) => {
              release(item);
              item.taken();
            });
          request.run();
          return;
        }
        signal?.addEventListener("abort", () => {
          const waiting = queue.indexOf(request);
          if (waiting === -1) return;
          queue.splice(waiting, 1);
          reject(aborted());
          grantWhatCan(name);
        });
        queue.push(request);
        grantWhatCan(name);
      });
    },
  };
}
