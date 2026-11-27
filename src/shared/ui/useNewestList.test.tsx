import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { SubscribeToNewest } from "../application/liveList";
import { useNewestList } from "./useNewestList";

/** A store whose answers the test sends, and that records how many items each read asked for. */
function heldStore() {
  let answer: (items: string[]) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const asked: (number | undefined)[] = [];
  let stopped = 0;
  const subscribe: SubscribeToNewest<string> = (onData, onError, newest) => {
    asked.push(newest);
    answer = onData;
    fail = onError;
    return () => {
      stopped += 1;
    };
  };
  return {
    subscribe,
    answer: (items: string[]) => {
      act(() => {
        answer(items);
      });
    },
    fail: (error: Error) => {
      act(() => {
        fail(error);
      });
    },
    asked,
    stopped: () => stopped,
  };
}

const named = (count: number) => Array.from({ length: count }, (_, index) => `item ${index + 1}`);

describe("useNewestList (T38)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for one more than a page, shows a page and offers more", () => {
    const store = heldStore();
    const { result } = renderHook(() => useNewestList(store.subscribe, "Loading things"));
    expect(result.current).toMatchObject({ items: null, hasMore: false, failed: false });
    store.answer(named(21));
    expect(store.asked).toEqual([21]);
    expect(result.current.items).toEqual(named(20));
    expect(result.current.hasMore).toBe(true);
  });

  it("offers nothing more when every item fits", () => {
    const store = heldStore();
    const { result } = renderHook(() => useNewestList(store.subscribe, "Loading things"));
    store.answer(named(20));
    expect(result.current.items).toEqual(named(20));
    expect(result.current.hasMore).toBe(false);
  });

  it("shows more by asking for the next page, keeping what is shown until it answers", () => {
    const store = heldStore();
    const { result } = renderHook(() => useNewestList(store.subscribe, "Loading things"));
    store.answer(named(21));
    act(() => {
      result.current.showMore();
    });
    expect(store.asked).toEqual([21, 41]);
    expect(store.stopped()).toBe(1);
    expect(result.current.items).toEqual(named(20));
    expect(result.current.hasMore).toBe(true);
    store.answer(named(25));
    expect(result.current.items).toEqual(named(25));
    expect(result.current.hasMore).toBe(false);
  });

  it("asks once when Show more is pressed again before the answer", () => {
    const store = heldStore();
    const { result } = renderHook(() => useNewestList(store.subscribe, "Loading things"));
    store.answer(named(21));
    act(() => {
      result.current.showMore();
    });
    act(() => {
      result.current.showMore();
    });
    expect(store.asked).toEqual([21, 41]);
  });

  it("keeps the same result across renders until the list answers again", () => {
    const store = heldStore();
    const { result, rerender } = renderHook(() => useNewestList(store.subscribe, "Loading things"));
    store.answer(named(3));
    const answered = result.current;
    rerender();
    expect(result.current).toBe(answered);
  });

  it("keeps what was shown when a read fails, and says why", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = heldStore();
    const { result } = renderHook(() => useNewestList(store.subscribe, "Loading things"));
    store.answer(named(3));
    store.fail(new Error("boom"));
    expect(result.current).toMatchObject({
      items: named(3),
      failed: true,
      failure: "unknown",
      hasMore: false,
    });
  });
});
