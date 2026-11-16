export type LockMode = "shared" | "exclusive";

/** The part of the browser's Web Locks (`navigator.locks`) used here. */
export interface Locks {
  request<T>(
    name: string,
    options: { mode: LockMode; signal?: AbortSignal; steal?: boolean },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export interface AccountLock {
  /** False in a browser without Web Locks, where nothing ever waits. */
  available: boolean;
  /**
   * Runs `work` while holding the account's lock together with any other shared holder. The
   * result must not be a promise, or the lock would be held until it settles.
   */
  shared<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Runs `work` while holding the account's lock alone, once every earlier holder let go. Null,
   * without running it, when the lock was not free within `timeoutMs`.
   */
  exclusive<T>(work: () => Promise<T>, timeoutMs: number): Promise<{ value: T } | null>;
  /**
   * Runs `work` while holding the account's lock alone, taken at once from whoever holds it:
   * their wait for it rejects with an "AbortError", though what they were doing goes on.
   */
  takeOver<T>(work: () => Promise<T>): Promise<{ value: T }>;
}

/** The browser's Web Locks, shared by every tab of the app, or none in an older browser. */
export function browserLocks(): Locks | undefined {
  return "locks" in navigator ? (navigator.locks as unknown as Locks) : undefined;
}

/**
 * One lock per account, shared by all the app's tabs in this browser. The browser lets go of a
 * tab's lock when that tab closes or crashes, so nothing stays locked for ever.
 */
export function createAccountLock(userId: string, locks: Locks | undefined): AccountLock {
  const name = `sportime.account.${userId}`;

  if (!locks) {
    return {
      available: false,
      shared: (work) => work(),
      exclusive: async (work) => ({ value: await work() }),
      takeOver: async (work) => ({ value: await work() }),
    };
  }

  return {
    available: true,
    shared: (work) => locks.request(name, { mode: "shared" }, work),
    async exclusive(work, timeoutMs) {
      const giveUp = new AbortController();
      const timer = setTimeout(() => {
        giveUp.abort();
      }, timeoutMs);
      let granted = false;
      try {
        return await locks.request(name, { mode: "exclusive", signal: giveUp.signal }, async () => {
          granted = true;
          clearTimeout(timer);
          return { value: await work() };
        });
      } catch (error) {
        // Only the wait was abandoned: what the work throws is the caller's.
        if (!granted && giveUp.signal.aborted) return null;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    takeOver: (work) =>
      locks.request(name, { mode: "exclusive", steal: true }, async () => ({
        value: await work(),
      })),
  };
}
