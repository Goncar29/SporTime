import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { SubscribeToList } from "../application/liveList";
import { useLiveList } from "./useLiveList";

/** A store whose answers the test sends, and that counts its reads. */
function heldStore() {
  let answer: (items: string[]) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  let reads = 0;
  const subscribe: SubscribeToList<string> = (onData, onError) => {
    reads += 1;
    answer = onData;
    fail = onError;
    return () => undefined;
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
    reads: () => reads,
  };
}

describe("useLiveList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the same result across renders until the list answers again", () => {
    const store = heldStore();
    const { result, rerender } = renderHook(() => useLiveList(store.subscribe, "Loading things"));
    const loading = result.current;
    rerender();
    expect(result.current).toBe(loading);
    store.answer(["a"]);
    const answered = result.current;
    expect(answered).not.toBe(loading);
    expect(answered.items).toEqual(["a"]);
    rerender();
    expect(result.current).toBe(answered);
    expect(result.current.retry).toBe(loading.retry);
  });

  it("shows loading, not the failure, while a retried read has not answered", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = heldStore();
    const { result } = renderHook(() => useLiveList(store.subscribe, "Loading things"));
    store.answer(["a"]);
    store.fail(new Error("boom"));
    expect(result.current).toMatchObject({ items: ["a"], failed: true, failure: "unknown" });
    act(() => {
      result.current.retry();
    });
    expect(store.reads()).toBe(2);
    expect(result.current).toMatchObject({ items: null, failed: false, failure: null });
    store.answer(["a", "b"]);
    expect(result.current).toMatchObject({ items: ["a", "b"], failed: false, failure: null });
  });

  it("leaves a healthy list as it is when asked to retry", () => {
    const store = heldStore();
    const { result } = renderHook(() => useLiveList(store.subscribe, "Loading things"));
    store.answer(["a"]);
    const answered = result.current;
    act(() => {
      result.current.retry();
    });
    expect(store.reads()).toBe(1);
    expect(result.current).toBe(answered);
    expect(result.current).toMatchObject({ items: ["a"], failed: false, failure: null });
  });

  it("retries again when the retried read fails too", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = heldStore();
    const { result } = renderHook(() => useLiveList(store.subscribe, "Loading things"));
    store.fail(new Error("boom"));
    act(() => {
      result.current.retry();
    });
    store.fail(new Error("boom again"));
    expect(result.current).toMatchObject({ items: null, failed: true, failure: "unknown" });
    act(() => {
      result.current.retry();
    });
    expect(store.reads()).toBe(3);
    store.answer(["a"]);
    expect(result.current).toMatchObject({ items: ["a"], failed: false, failure: null });
  });
});
