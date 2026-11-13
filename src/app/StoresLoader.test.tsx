import { act, fireEvent, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../i18n/ui/I18nProvider";
import { StoresLoader, createStoresLoad } from "./StoresLoader";

const renderLoader = async (load: () => Promise<string>) => {
  const store = { get: () => null, set: vi.fn() };
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () => {
    render(
      <I18nProvider store={store} browserLanguages={["en-US"]}>
        <StoresLoader load={createStoresLoad(load)}>
          {(loaded) => <p>Loaded {loaded}</p>}
        </StoresLoader>
      </I18nProvider>,
    );
  });
  return { consoleError };
};

/** Stands in for whatever handles errors above the loader. */
class Outer extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <p>Handled above</p> : this.props.children;
  }
}

function Broken(): ReactNode {
  throw new Error("bug in the app");
}

describe("StoresLoader", () => {
  it("leaves errors in the loaded app to whatever handles them above", async () => {
    const store = { get: () => null, set: vi.fn() };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      render(
        <I18nProvider store={store} browserLanguages={["en-US"]}>
          <Outer>
            <StoresLoader load={createStoresLoad(() => Promise.resolve("stores"))}>
              {() => <Broken />}
            </StoresLoader>
          </Outer>
        </I18nProvider>,
      );
    });
    expect(screen.getByText("Handled above")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("shows what it loaded", async () => {
    await renderLoader(() => Promise.resolve("stores"));
    expect(await screen.findByText("Loaded stores")).toBeInTheDocument();
  });

  it("says when loading failed, logs why, and loads again on retry", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce("stores");
    const { consoleError } = await renderLoader(load);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load your account. Check your connection and try again.",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Loading the account's stores failed:",
      expect.any(Error),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByText("Loaded stores")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("loads once, and keeps a failure until asked to retry", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValue("stores");
    const stores = createStoresLoad(load);
    const failed = stores.current();
    expect(stores.current()).toBe(failed);
    await expect(failed).rejects.toMatchObject({ cause: new Error("chunk failed") });
    expect(stores.current()).toBe(failed);
    stores.retry();
    await expect(stores.current()).resolves.toBe("stores");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
