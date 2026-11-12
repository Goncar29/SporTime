import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../../i18n/ui/I18nProvider";
import type { InstallController, InstallState } from "../application/ports";
import { DISMISS_FOR_MS } from "../domain/install";
import { InstallBanner, InstallOption } from "./InstallBanner";
import { InstallProvider } from "./InstallProvider";

function fakeInstall(initial: InstallState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const controller: InstallController = {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    install: vi.fn(() => {
      state = "installed";
      listeners.forEach((listener) => {
        listener();
      });
      return Promise.resolve("accepted" as const);
    }),
  };
  return controller;
}

function memoryDismissals(initial: number | null = null) {
  let value = initial;
  return {
    get: () => value,
    set: vi.fn((next: number) => {
      value = next;
    }),
  };
}

const NOW = 1_800_000_000_000;

function setup(state: InstallState, dismissals = memoryDismissals()) {
  const controller = fakeInstall(state);
  const view = render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["en-US"]}>
      <InstallProvider controller={controller} dismissals={dismissals} now={() => NOW}>
        <InstallBanner />
        <InstallOption />
      </InstallProvider>
    </I18nProvider>,
  );
  return { controller, dismissals, view };
}

const banner = () => screen.queryByRole("region", { name: "Install Sportime" });

describe("InstallBanner", () => {
  it("offers installing and opens the browser's dialog", async () => {
    const { controller } = setup("prompt");
    expect(banner()).toHaveTextContent("Install Sportime on your phone");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });

    expect(controller.install).toHaveBeenCalledOnce();
    expect(banner()).not.toBeInTheDocument();
  });

  it("hides for 30 days after 'Not now', remembering when", () => {
    const { dismissals } = setup("prompt");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(banner()).not.toBeInTheDocument();
    expect(dismissals.set).toHaveBeenCalledWith(NOW);
  });

  it("stays hidden while dismissed", () => {
    setup("prompt", memoryDismissals(NOW - DISMISS_FOR_MS + 1));
    expect(banner()).not.toBeInTheDocument();
  });

  it("comes back after 30 days", () => {
    setup("prompt", memoryDismissals(NOW - DISMISS_FOR_MS));
    expect(banner()).toBeInTheDocument();
  });

  it("gives the steps on an iPhone instead of a button", () => {
    setup("ios");
    expect(banner()).toHaveTextContent("tap Share, then “Add to Home Screen”");
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("shows nothing when installed or where installing is not possible", () => {
    for (const state of ["installed", "unavailable"] as const) {
      const { view } = setup(state);
      expect(banner()).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("InstallOption", () => {
  it("stays available after 'Not now' and installs from there", async () => {
    const { controller } = setup("prompt", memoryDismissals(NOW));
    expect(banner()).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    });

    expect(controller.install).toHaveBeenCalledOnce();
  });

  it("shows the steps on an iPhone when tapped", () => {
    setup("ios", memoryDismissals(NOW));
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(screen.getByText(/tap Share, then “Add to Home Screen”/)).toBeInTheDocument();
  });
});
