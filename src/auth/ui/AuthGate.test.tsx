import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../../i18n/ui/I18nProvider";
import type { AuthGateway } from "../application/ports";
import { AuthFailure, type User } from "../domain/user";
import { AccountMenu } from "./AccountMenu";
import { AuthGate } from "./AuthGate";

const carlos: User = {
  id: "u1",
  name: "Carlos Gonzalez",
  email: "c@example.com",
  photoUrl: "https://example.com/p.jpg",
};

function setup({ language = "en", gateway = {} as Partial<AuthGateway> } = {}) {
  let emit: (user: User | null) => void = () => undefined;
  const fake = {
    subscribe: vi.fn((listener: (user: User | null) => void) => {
      emit = listener;
      return () => undefined;
    }),
    signIn: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    completePendingSignIn: vi.fn(() => Promise.resolve()),
    ...gateway,
  };
  render(
    <I18nProvider store={{ get: () => language, set: vi.fn() }} browserLanguages={[]}>
      <AuthGate gateway={fake}>
        <p>Private app</p>
        <AccountMenu />
      </AuthGate>
    </I18nProvider>,
  );
  return { fake, emit: (user: User | null) => act(() => emit(user)) };
}

const googleButton = () => screen.getByRole("button", { name: "Continue with Google" });

describe("AuthGate", () => {
  it("shows neither the app nor the sign-in button until the session is known", () => {
    setup();
    expect(screen.queryByText("Private app")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  });

  it("requires signing in, and says which data is used", () => {
    const { emit } = setup();
    emit(null);
    expect(screen.queryByText("Private app")).not.toBeInTheDocument();
    expect(googleButton()).toBeInTheDocument();
    expect(screen.getByText(/name, email and profile photo/)).toBeInTheDocument();
  });

  it("starts the Google sign-in from the button", async () => {
    const { emit, fake } = setup();
    emit(null);
    await act(async () => {
      fireEvent.click(googleButton());
      await Promise.resolve();
    });
    expect(fake.signIn).toHaveBeenCalledOnce();
  });

  it("does not start a second sign-in while one is in progress", async () => {
    const pending = new Promise<void>(() => undefined);
    const { emit, fake } = setup({ gateway: { signIn: vi.fn(() => pending) } });
    emit(null);
    fireEvent.click(googleButton());
    await act(() => Promise.resolve());
    const button = screen.getByRole("button", { name: "Opening Google…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fake.signIn).toHaveBeenCalledOnce();
  });

  it("shows the app once signed in, and leaves it after signing out", async () => {
    const { emit, fake } = setup();
    emit(carlos);
    expect(screen.getByText("Private app")).toBeInTheDocument();
    expect(screen.getByText("Carlos Gonzalez")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await Promise.resolve();
    });
    expect(fake.signOut).toHaveBeenCalledOnce();

    emit(null);
    expect(screen.queryByText("Private app")).not.toBeInTheDocument();
  });

  it("explains a missing connection", async () => {
    const { emit } = setup({
      gateway: { signIn: vi.fn(() => Promise.reject(new AuthFailure("network"))) },
    });
    emit(null);
    await act(async () => {
      fireEvent.click(googleButton());
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/connection/);
    expect(googleButton()).toBeEnabled();
  });

  it("stays quiet when the user cancels", async () => {
    const { emit } = setup({
      gateway: { signIn: vi.fn(() => Promise.reject(new AuthFailure("cancelled"))) },
    });
    emit(null);
    await act(async () => {
      fireEvent.click(googleButton());
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(googleButton()).toBeEnabled();
  });

  it("reports a failed redirect sign-in when returning to the app", async () => {
    const { emit } = setup({
      gateway: {
        completePendingSignIn: vi.fn(() => Promise.reject(new AuthFailure("unknown"))),
      },
    });
    await act(() => Promise.resolve());
    emit(null);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't sign you in/);
  });

  it("is translated", () => {
    const { emit } = setup({ language: "es" });
    emit(null);
    expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeInTheDocument();
  });
});

describe("AccountMenu", () => {
  it("shows the photo without sending the app address to the image host", () => {
    const { emit } = setup();
    emit(carlos);
    const photo = screen.getByRole("img");
    expect(photo).toHaveAttribute("src", carlos.photoUrl);
    expect(photo).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("shows initials when there is no photo", () => {
    const { emit } = setup();
    emit({ ...carlos, photoUrl: null });
    expect(screen.getByText("CG")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("falls back to initials when the photo cannot load, such as offline", () => {
    const { emit } = setup();
    emit(carlos);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("CG")).toBeInTheDocument();
  });
});
