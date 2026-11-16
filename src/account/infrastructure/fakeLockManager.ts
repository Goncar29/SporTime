import type { Locks, LockMode } from "./accountLock";

interface Request {
  name: string;
  mode: LockMode;
  run: () => void;
}

/**
 * The part of the browser's Web Locks that the app uses, for tests: jsdom has none. Requests for
 * one name are granted in the order they were made; shared ones run together, an exclusive one
 * runs alone. Like the browser, every tab of the app shares one, so tests give both tabs the same.
 */
export function createFakeLockManager(): Locks {
  const queue: Request[] = [];
  const held: { name: string; mode: LockMode }[] = [];

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
    request(name, { mode, signal }, callback) {
      return new Promise((resolve, reject) => {
        const aborted = () => new DOMException("The lock request was aborted", "AbortError");
        if (signal?.aborted) {
          reject(aborted());
          return;
        }
        const request: Request = {
          name,
          mode,
          run() {
            const lock = { name, mode };
            held.push(lock);
            void Promise.resolve()
              .then(callback)
              .then(resolve, reject)
              .finally(() => {
                held.splice(held.indexOf(lock), 1);
                grantWhatCan(name);
              });
          },
        };
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
