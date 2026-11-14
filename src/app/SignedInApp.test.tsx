import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SignOutOptions, SignOutResult } from "../account/application/signOut";
import type { AuthGateway } from "../auth/application/ports";
import type { User } from "../auth/domain/user";
import { AccountMenu } from "../auth/ui/AccountMenu";
import { AuthGate } from "../auth/ui/AuthGate";
import { createFakeHistoryLog } from "../history/infrastructure/fakeHistoryLog";
import { I18nProvider } from "../i18n/ui/I18nProvider";
import { createFakeWorkoutLibrary } from "../workouts/infrastructure/fakeWorkoutLibrary";
import { SignedInApp } from "./SignedInApp";

const person = (id: string): User => ({ id, name: id, email: `${id}@example.com`, photoUrl: null });

type SignOut = (options?: SignOutOptions) => Promise<SignOutResult>;

interface Options {
  language?: "en" | "es";
  /** The account's sign-out. By default it signs out with the provider, like a real one. */
  signOut?: SignOut;
}

function setup({ language = "en", signOut }: Options = {}) {
  let report: (user: User | null) => void = () => undefined;
  const gateway = {
    subscribe(listener: (user: User | null) => void) {
      report = listener;
      listener(person("alice"));
      return () => undefined;
    },
    signIn: () => Promise.resolve(),
    signOut: vi.fn(() => {
      report(null);
      return Promise.resolve();
    }),
    completePendingSignIn: () => Promise.resolve(),
  } satisfies AuthGateway;
  const accountSignOut = vi.fn<SignOut>(
    signOut ??
      (async () => {
        await gateway.signOut();
        return "signedOut";
      }),
  );
  const reload = vi.fn();
  const timer = {
    clock: { now: () => 0 },
    cues: { unlock: vi.fn(), play: vi.fn(), vibrate: vi.fn() },
    voice: { unlock: vi.fn(), canSpeak: () => false, say: vi.fn() },
    soundStore: { get: () => null, set: vi.fn() },
    screenAwake: { acquire: vi.fn(), release: vi.fn() },
  };
  const storesFor = (userId: string) => ({
    workouts: createFakeWorkoutLibrary(userId),
    history: createFakeHistoryLog(userId),
    deleteAccount: () => Promise.resolve(),
    deletionConfirmedByRedirect: () => Promise.resolve(false),
    signOut: accountSignOut,
  });
  render(
    <I18nProvider store={{ get: () => language, set: vi.fn() }} browserLanguages={["en-US"]}>
      <AuthGate gateway={gateway}>
        <SignedInApp
          timer={timer}
          storesFor={storesFor}
          reload={reload}
          account={(state) => <AccountMenu signOut={state} />}
        />
      </AuthGate>
    </I18nProvider>,
  );
  return {
    gateway,
    signOut: accountSignOut,
    reload,
    switchTo: (id: string) => {
      act(() => {
        report(person(id));
      });
    },
  };
}

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
};

/** A sign-out the test settles by hand. */
function deferred() {
  let resolve: (result: SignOutResult) => void = () => undefined;
  const promise = new Promise<SignOutResult>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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
    const openSaved = () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    };
    openSaved();
    expect(screen.getByRole("button", { name: /^Alice EMOM/ })).toBeInTheDocument();

    switchTo("bob");
    expect(screen.getByRole("button", { name: /^Tabata/ })).toHaveAttribute("aria-pressed", "true");
    openSaved();
    expect(screen.queryByRole("button", { name: /^Alice EMOM/ })).not.toBeInTheDocument();

    switchTo("alice");
    openSaved();
    expect(screen.getByRole("button", { name: /^Alice EMOM/ })).toBeInTheDocument();
  });
});

describe("signing out", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localStorage.clear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it("with nothing pending, signs out through the account, shows sign-in and reloads the page", async () => {
    const { gateway, signOut, reload } = setup();
    await click("Profile");
    await click("Sign out");
    expect(signOut).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledWith(undefined);
    expect(gateway.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("says it is signing out meanwhile, and the button cannot be pressed twice", async () => {
    const sending = deferred();
    const { signOut, reload } = setup({ signOut: () => sending.promise });
    await click("Profile");
    await click("Sign out");
    expect(screen.getByRole("status")).toHaveTextContent("Signing out…");
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(signOut).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("warns about unsent changes; Stay closes the warning and changes nothing", async () => {
    const { gateway, signOut, reload } = setup({ signOut: () => Promise.resolve("unsent") });
    await click("Profile");
    await click("Sign out");
    const dialog = screen.getByRole("alertdialog", { name: "Unsent changes" });
    expect(dialog).toHaveTextContent(
      "You have unsent changes. If you sign out now, they will be lost.",
    );
    expect(within(dialog).getByRole("button", { name: "Stay" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Sign out anyway" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await click("Stay");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(signOut).toHaveBeenCalledOnce();
    expect(gateway.signOut).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("Sign out anyway signs out with the unsent changes dropped, then reloads", async () => {
    const { gateway, signOut, reload } = setup({
      signOut: async (options) => {
        if (!options?.force) return "unsent";
        await gateway.signOut();
        return "signedOut";
      },
    });
    await click("Profile");
    await click("Sign out");
    expect(reload).not.toHaveBeenCalled();
    await click("Sign out anyway");
    expect(signOut).toHaveBeenCalledTimes(2);
    expect(signOut).toHaveBeenLastCalledWith({ force: true });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("is translated", async () => {
    const sending = deferred();
    setup({ language: "es", signOut: () => sending.promise });
    await click("Perfil");
    await click("Cerrar sesión");
    expect(screen.getByRole("status")).toHaveTextContent("Cerrando sesión…");
    await act(async () => {
      sending.resolve("unsent");
      await Promise.resolve();
    });
    const dialog = screen.getByRole("alertdialog", { name: "Cambios sin enviar" });
    expect(dialog).toHaveTextContent(
      "Tenés cambios sin enviar. Si cerrás sesión ahora se pierden.",
    );
    expect(within(dialog).getByRole("button", { name: "Quedarme" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cerrar sesión igual" })).toBeInTheDocument();
  });

  it("explains a refused sign-out, keeps the session and does not reload", async () => {
    const { reload } = setup({ signOut: () => Promise.reject(new Error("network")) });
    await click("Profile");
    await click("Sign out");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't sign you out. Please try again.",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
