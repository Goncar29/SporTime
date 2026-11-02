import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AuthGateway } from "../auth/application/ports";
import type { User } from "../auth/domain/user";
import { AuthGate } from "../auth/ui/AuthGate";
import { createFakeHistoryLog } from "../history/infrastructure/fakeHistoryLog";
import { I18nProvider } from "../i18n/ui/I18nProvider";
import { createFakeWorkoutLibrary } from "../workouts/infrastructure/fakeWorkoutLibrary";
import { SignedInApp } from "./SignedInApp";

const person = (id: string): User => ({ id, name: id, email: `${id}@example.com`, photoUrl: null });

function setup() {
  let report: (user: User | null) => void = () => undefined;
  const gateway: AuthGateway = {
    subscribe(listener) {
      report = listener;
      listener(person("alice"));
      return () => undefined;
    },
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    completePendingSignIn: () => Promise.resolve(),
  };
  const timer = {
    clock: { now: () => 0 },
    cues: { unlock: vi.fn(), play: vi.fn() },
    screenAwake: { acquire: vi.fn(), release: vi.fn() },
  };
  const storesFor = (userId: string) => ({
    workouts: createFakeWorkoutLibrary(userId),
    history: createFakeHistoryLog(userId),
  });
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["en-US"]}>
      <AuthGate gateway={gateway}>
        <SignedInApp timer={timer} storesFor={storesFor} />
      </AuthGate>
    </I18nProvider>,
  );
  return {
    switchTo(id: string) {
      act(() => {
        report(person(id));
      });
    },
  };
}

describe("SignedInApp", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows each account only its own saved workouts, and no leftover draft settings", () => {
    const { switchTo } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^EMOM/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workout name" }), {
      target: { value: "Alice EMOM" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: /^Alice EMOM/ })).toBeInTheDocument();

    switchTo("bob");
    expect(screen.queryByRole("button", { name: /^Alice EMOM/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Tabata/ })).toHaveAttribute("aria-pressed", "true");

    switchTo("alice");
    expect(screen.getByRole("button", { name: /^Alice EMOM/ })).toBeInTheDocument();
  });
});
