import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { deleteAccount as deleteAccountOf } from "../account/application/deleteAccount";
import type { OtherTabsStatus } from "../account/application/ports";
import type { SignOutOptions, SignOutResult } from "../account/application/signOut";
import type { AuthGateway } from "../auth/application/ports";
import { AuthFailure, type User } from "../auth/domain/user";
import { AccountMenu } from "../auth/ui/AccountMenu";
import { AuthGate } from "../auth/ui/AuthGate";
import { createFakeHistoryLog } from "../history/infrastructure/fakeHistoryLog";
import { I18nProvider } from "../i18n/ui/I18nProvider";
import { createFakeRoutineLibrary } from "../routines/infrastructure/fakeRoutineLibrary";
import { createFakeWorkoutLibrary } from "../workouts/infrastructure/fakeWorkoutLibrary";
import { SignedInApp } from "./SignedInApp";

const person = (id: string): User => ({ id, name: id, email: `${id}@example.com`, photoUrl: null });

type SignOut = (options?: SignOutOptions) => Promise<SignOutResult>;

interface Options {
  language?: "en" | "es";
  /** The account's sign-out. By default it signs out with the provider, like a real one. */
  signOut?: SignOut;
  /** What the account's other open tabs are doing; none by default, as in the e2e build. */
  otherTabs?: ReturnType<typeof createOtherTabsStatus>;
  /** The account's deletion; by default it removes the account, which signs it out. */
  deleteAccount?: () => Promise<void>;
}

/** The other tabs' status as the account's stores report it, changed by the test. */
function createOtherTabsStatus() {
  let current: OtherTabsStatus = "idle";
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: OtherTabsStatus) {
      act(() => {
        current = next;
        listeners.forEach((listener) => {
          listener();
        });
      });
    },
  };
}

function setup({ language = "en", signOut, otherTabs, deleteAccount }: Options = {}) {
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
    routines: createFakeRoutineLibrary(userId),
    deleteAccount:
      deleteAccount ??
      (async () => {
        await gateway.signOut();
      }),
    deletionConfirmedByRedirect: () => Promise.resolve(false),
    signOut: accountSignOut,
    otherTabs,
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

  it("blocks the screens and the tab bar meanwhile, and frees them when changes stay unsent", async () => {
    const sending = deferred();
    setup({ signOut: () => sending.promise });
    await click("Profile");
    await click("Sign out");
    const blocked = (element: HTMLElement) => element.closest("[inert]") !== null;
    expect(blocked(screen.getByRole("button", { name: "Saved" }))).toBe(true);
    expect(blocked(screen.getByRole("button", { name: "Settings" }))).toBe(true);
    expect(blocked(screen.getByRole("heading", { level: 1, name: "Profile" }))).toBe(true);
    // The progress stays visible and announced, outside the blocked part.
    expect(blocked(screen.getByRole("status"))).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("Signing out…");

    await act(async () => {
      sending.resolve("unsent");
      await Promise.resolve();
    });
    expect(blocked(screen.getByRole("button", { name: "Saved" }))).toBe(false);
    expect(blocked(screen.getByRole("alertdialog", { name: "Unsent changes" }))).toBe(false);
    await click("Stay");
    expect(blocked(screen.getByRole("button", { name: "Sign out" }))).toBe(false);
  });

  it("frees the screens and the tab bar when the sign-out fails", async () => {
    let refuse: (error: Error) => void = () => undefined;
    setup({
      signOut: () =>
        new Promise<SignOutResult>((_, reject) => {
          refuse = reject;
        }),
    });
    await click("Profile");
    await click("Sign out");
    expect(screen.getByRole("button", { name: "Saved" }).closest("[inert]")).not.toBeNull();

    await act(async () => {
      refuse(new Error("network"));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Saved" }).closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" }).closest("[inert]")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't sign you out. Please try again.",
    );
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
      "Tienes cambios sin enviar. Si cierras sesión ahora, se perderán.",
    );
    expect(within(dialog).getByRole("button", { name: "Quedarme" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cerrar sesión igual" })).toBeInTheDocument();
  });

  describe("in another tab", () => {
    const blocked = (element: HTMLElement) => element.closest("[inert]") !== null;

    it("shows that another tab is signing out and blocks this one until it ends without signing out", () => {
      const otherTabs = createOtherTabsStatus();
      setup({ otherTabs });
      // The Timer's own values are outputs, which are statuses too, so it is found by its text.
      const notice = () => screen.queryByText("Signing out in another tab…");
      expect(notice()).not.toBeInTheDocument();

      otherTabs.set("signingOut");
      expect(notice()).toHaveAttribute("role", "status");
      expect(blocked(notice() as HTMLElement)).toBe(false);
      expect(blocked(screen.getByRole("button", { name: "Saved" }))).toBe(true);
      expect(blocked(screen.getByRole("button", { name: /^Start/ }))).toBe(true);

      otherTabs.set("idle");
      expect(notice()).not.toBeInTheDocument();
      expect(blocked(screen.getByRole("button", { name: "Saved" }))).toBe(false);
      expect(blocked(screen.getByRole("button", { name: /^Start/ }))).toBe(false);
    });

    it("says a change could not be saved because another tab signed out, with the app blocked", () => {
      const otherTabs = createOtherTabsStatus();
      setup({ otherTabs });
      otherTabs.set("lostChange");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't save: you signed out in another tab.",
      );
      expect(blocked(screen.getByRole("alert"))).toBe(false);
      expect(blocked(screen.getByRole("button", { name: "Saved" }))).toBe(true);
    });

    it("is translated", () => {
      const otherTabs = createOtherTabsStatus();
      setup({ language: "es", otherTabs });
      otherTabs.set("signingOut");
      expect(screen.getByText("Cerrando sesión en otra pestaña…")).toHaveAttribute(
        "role",
        "status",
      );
      otherTabs.set("lostChange");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudo guardar: se cerró la sesión en otra pestaña.",
      );
    });

    it("keeps the sign-out texts exactly as they were, never the deletion ones", () => {
      const otherTabs = createOtherTabsStatus();
      setup({ otherTabs });
      otherTabs.set("signingOut");
      expect(screen.getByText(/^Signing out in another tab…$/)).toHaveAttribute("role", "status");
      expect(screen.queryByText("Deleting the account in another tab…")).not.toBeInTheDocument();
      otherTabs.set("lostChange");
      expect(screen.getByRole("alert")).toHaveTextContent(
        /^Couldn't save: you signed out in another tab\.$/,
      );
    });

    it("shows that another tab is deleting the account, blocking this one", () => {
      const otherTabs = createOtherTabsStatus();
      setup({ otherTabs });
      otherTabs.set("deletingAccount");
      const notice = screen.getByText("Deleting the account in another tab…");
      expect(notice).toHaveAttribute("role", "status");
      expect(blocked(notice)).toBe(false);
      expect(blocked(screen.getByRole("button", { name: "Saved" }))).toBe(true);
      expect(screen.queryByText("Signing out in another tab…")).not.toBeInTheDocument();
    });

    it("says a change could not be saved because another tab deleted the account", () => {
      const otherTabs = createOtherTabsStatus();
      setup({ otherTabs });
      otherTabs.set("lostChangeAccountDeleted");
      expect(screen.getByRole("alert")).toHaveTextContent(
        /^Couldn't save: the account was deleted in another tab\.$/,
      );
      expect(blocked(screen.getByRole("button", { name: "Saved" }))).toBe(true);
    });

    it("translates the deletion in another tab", () => {
      const otherTabs = createOtherTabsStatus();
      setup({ language: "es", otherTabs });
      otherTabs.set("deletingAccount");
      expect(screen.getByText("Borrando la cuenta en otra pestaña…")).toHaveAttribute(
        "role",
        "status",
      );
      otherTabs.set("lostChangeAccountDeleted");
      expect(screen.getByRole("alert")).toHaveTextContent(
        /^No se pudo guardar: se borró la cuenta en otra pestaña\.$/,
      );
    });
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

describe("deleting the account", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const accept = async () => {
    await click("Profile");
    await click("Delete account");
    await click("Delete my account");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it("reloads the page once the account is gone, so a later sign-in here starts afresh", async () => {
    const { reload } = setup();
    await accept();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("says nothing was deleted when a change in another tab held it up", async () => {
    const { reload } = setup({
      language: "es",
      deleteAccount: () =>
        deleteAccountOf({
          identity: {
            isRecentlyConfirmed: () => Promise.resolve(true),
            confirm: () => Promise.resolve(),
            confirmedByRedirect: () => Promise.resolve(false),
            remove: () => Promise.resolve(),
          },
          data: { erase: () => Promise.resolve() },
          // That tab's change did not let go within the wait.
          otherTabs: { holdOff: () => Promise.resolve(null), changeWaitingHere: () => false },
        }),
    });
    await click("Perfil");
    await click("Eliminar cuenta");
    await click("Eliminar mi cuenta");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^No se borró nada: hay un cambio guardándose en otra pestaña\. Prueba de nuevo en unos segundos\.$/,
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the deletion fails, and says why", async () => {
    const { reload } = setup({ deleteAccount: () => Promise.reject(new AuthFailure("network")) });
    await accept();
    expect(screen.getByRole("alert")).toHaveTextContent(/connection/);
    expect(reload).not.toHaveBeenCalled();
  });
});
