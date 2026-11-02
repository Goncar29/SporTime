import { describe, expect, it, vi } from "vite-plus/test";
import type { User } from "../domain/user";
import type { AuthGateway } from "./ports";
import { withCachedSession, type SessionSnapshotStore } from "./cachedSessionGateway";

const carlos: User = { id: "u1", name: "Carlos", email: "c@example.com", photoUrl: null };

function setup(stored: User | null) {
  let emit: (user: User | null) => void = () => undefined;
  const inner: AuthGateway = {
    subscribe: vi.fn((listener: (user: User | null) => void) => {
      emit = listener;
      return () => undefined;
    }),
    signIn: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    completePendingSignIn: vi.fn(() => Promise.resolve()),
  };
  const store: SessionSnapshotStore = {
    get: vi.fn(() => stored),
    set: vi.fn(),
    clear: vi.fn(),
  };
  const listener = vi.fn();
  return {
    gateway: withCachedSession(inner, store),
    inner,
    store,
    listener,
    emit: (user: User | null) => emit(user),
  };
}

describe("withCachedSession", () => {
  it("reports the last known user at once, without waiting for the network", () => {
    const { gateway, listener } = setup(carlos);
    gateway.subscribe(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith(carlos);
  });

  it("reports nothing until the real answer when no session is known", () => {
    const { gateway, listener, emit } = setup(null);
    gateway.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    emit(null);
    expect(listener).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("remembers the user the real session reports", () => {
    const { gateway, listener, store, emit } = setup(null);
    gateway.subscribe(listener);
    emit(carlos);
    expect(store.set).toHaveBeenCalledWith(carlos);
    expect(listener).toHaveBeenCalledWith(carlos);
  });

  it("locks the app and forgets the user when the real session has ended", () => {
    const { gateway, listener, store, emit } = setup(carlos);
    gateway.subscribe(listener);
    emit(null);
    expect(store.clear).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it("passes the other operations through", async () => {
    const { gateway, inner } = setup(null);
    await gateway.signIn();
    await gateway.signOut();
    await gateway.completePendingSignIn();
    expect(inner.signIn).toHaveBeenCalledOnce();
    expect(inner.signOut).toHaveBeenCalledOnce();
    expect(inner.completePendingSignIn).toHaveBeenCalledOnce();
  });
});
