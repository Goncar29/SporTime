import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createLocalStorageOutboxStore } from "../../shared/infrastructure/localStorageOutboxStore";
import { createLocalAccountData } from "./localAccountData";

const WORKOUTS_KEY = "sportime.outbox.workouts.u1";
const HISTORY_KEY = "sportime.outbox.history.u1";
const DEVICE_SETTINGS = {
  "sportime.language": "es",
  "sportime.soundSettings": '{"voice":true}',
  "sportime.installDismissedAt": "1000",
};

function setup({ held = [0, 0] } = {}) {
  const calls: string[] = [];
  const workoutOutbox = createLocalStorageOutboxStore(WORKOUTS_KEY);
  const historyOutbox = createLocalStorageOutboxStore(HISTORY_KEY);
  workoutOutbox.save([{ id: "w1", draft: {} }]);
  historyOutbox.save([{ id: "h1", draft: {} }]);
  const outboxes = held.map((count, index) => ({
    flushNow: vi.fn(() => {
      calls.push(`flush${index}`);
      return Promise.resolve(count);
    }),
  }));
  const deps = {
    outboxes,
    discardPendingWrites: () => {
      workoutOutbox.save([]);
      historyOutbox.save([]);
    },
    serverHasWrites: vi.fn(() => {
      calls.push("serverHasWrites");
      return Promise.resolve();
    }),
    clearCache: vi.fn(() => {
      calls.push("clearCache");
      return Promise.resolve();
    }),
    forget: vi.fn(() => {
      calls.push("forget");
    }),
  };
  return { data: createLocalAccountData(deps), deps, calls };
}

const outboxKeys = () => [localStorage.getItem(WORKOUTS_KEY), localStorage.getItem(HISTORY_KEY)];

describe("createLocalAccountData", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.entries(DEVICE_SETTINGS).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("sendPending", () => {
    it("hands both outboxes to Firestore, waits for the server, then checks again for later changes", async () => {
      const { data, calls } = setup();
      await expect(data.sendPending()).resolves.toBe("sent");
      expect(calls).toEqual([
        "flush0",
        "flush1",
        "serverHasWrites",
        "flush0",
        "flush1",
        "serverHasWrites",
      ]);
    });

    it("reports unsent when a change made while waiting is still held", async () => {
      const { data, deps } = setup();
      deps.outboxes[1]?.flushNow.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      await expect(data.sendPending()).resolves.toBe("unsent");
      expect(deps.serverHasWrites).toHaveBeenCalledOnce();
    });

    it("gives up when the second wait does not end within the same 10 seconds", async () => {
      vi.useFakeTimers();
      const { data, deps } = setup();
      deps.serverHasWrites
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 6_000);
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 6_000);
            }),
        );
      const result = data.sendPending();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(result).resolves.toBe("unsent");
      expect(deps.serverHasWrites).toHaveBeenCalledTimes(2);
    });

    it("reports unsent without trying while the browser is offline", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { data, deps } = setup();
      await expect(data.sendPending()).resolves.toBe("unsent");
      expect(deps.serverHasWrites).not.toHaveBeenCalled();
      expect(outboxKeys().every((value) => value !== null)).toBe(true);
    });

    it("reports unsent when an outbox still holds a write", async () => {
      const { data, deps } = setup({ held: [0, 1] });
      await expect(data.sendPending()).resolves.toBe("unsent");
      expect(deps.serverHasWrites).not.toHaveBeenCalled();
    });

    it("gives up after 10 seconds without an answer from the server", async () => {
      vi.useFakeTimers();
      const { data, deps } = setup();
      deps.serverHasWrites.mockReturnValue(new Promise(() => undefined));
      const result = data.sendPending();

      await vi.advanceTimersByTimeAsync(9_999);
      let settled = false;
      void result.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe("unsent");
    });

    it("reports unsent when Firestore stops waiting, as it does when the user changes", async () => {
      const { data, deps } = setup();
      deps.serverHasWrites.mockRejectedValue(new Error("user changed"));
      await expect(data.sendPending()).resolves.toBe("unsent");
    });

    it("keeps everything on the device, whatever the answer", async () => {
      const { data, deps } = setup({ held: [1, 0] });
      await data.sendPending();
      expect(deps.clearCache).not.toHaveBeenCalled();
      expect(outboxKeys().every((value) => value !== null)).toBe(true);
    });
  });

  describe("discardPending", () => {
    it("drops both outboxes and nothing else", () => {
      const { data, deps } = setup();
      data.discardPending();
      expect(outboxKeys()).toEqual([null, null]);
      expect(deps.clearCache).not.toHaveBeenCalled();
      Object.entries(DEVICE_SETTINGS).forEach(([key, value]) => {
        expect(localStorage.getItem(key)).toBe(value);
      });
    });
  });

  describe("erase", () => {
    it("drops both outboxes, clears Firestore's cache, then forgets the account", async () => {
      const { data, calls } = setup();
      await data.erase();
      expect(outboxKeys()).toEqual([null, null]);
      expect(calls).toEqual(["clearCache", "forget"]);
    });

    it("keeps the device's own settings", async () => {
      const { data } = setup();
      await data.erase();
      Object.entries(DEVICE_SETTINGS).forEach(([key, value]) => {
        expect(localStorage.getItem(key)).toBe(value);
      });
    });

    it("still forgets the account when the cache cannot be cleared, and reports it", async () => {
      const { data, deps } = setup();
      deps.clearCache.mockRejectedValue(new Error("failed-precondition"));
      await expect(data.erase()).rejects.toThrow("failed-precondition");
      expect(deps.forget).toHaveBeenCalledOnce();
      expect(outboxKeys()).toEqual([null, null]);
    });

    it("erases what else the device keeps of the account, such as seen routines (T27)", async () => {
      const { deps } = setup();
      localStorage.setItem("sportime.seenRoutines.u1", JSON.stringify(["r1"]));
      const data = createLocalAccountData({
        ...deps,
        eraseOnDevice: () => {
          localStorage.removeItem("sportime.seenRoutines.u1");
        },
      });
      data.discardPending();
      // Dropping unsent changes keeps it: only erasing does.
      expect(localStorage.getItem("sportime.seenRoutines.u1")).not.toBeNull();
      await data.erase();
      expect(localStorage.getItem("sportime.seenRoutines.u1")).toBeNull();
      expect(outboxKeys()).toEqual([null, null]);
      Object.entries(DEVICE_SETTINGS).forEach(([key, value]) => {
        expect(localStorage.getItem(key)).toBe(value);
      });
    });
  });
});
