import { describe, expect, it, vi } from "vite-plus/test";
import { connectUpdates, type UpdateRegistration } from "./connectUpdates";

function setup({ controlled = true } = {}) {
  const container = new EventTarget() as EventTarget & { controller: object | null };
  container.controller = controlled ? {} : null;
  let options: Parameters<UpdateRegistration>[0] | undefined;
  const switchToWaiting = vi.fn(async () => {
    // The waiting worker takes over, as skipWaiting does.
    container.dispatchEvent(new Event("controllerchange"));
  });
  const register: UpdateRegistration = (given) => {
    options = given;
    return switchToWaiting;
  };
  const reload = vi.fn();
  const updater = connectUpdates({ register, container, reload });
  return {
    updater,
    reload,
    switchToWaiting,
    newVersionWaiting: () => options?.onNeedRefresh?.(),
    otherTabApplied: () => container.dispatchEvent(new Event("controllerchange")),
  };
}

describe("connectUpdates", () => {
  it("switches to a waiting version and reloads once it has taken over", async () => {
    const { newVersionWaiting, switchToWaiting, reload } = setup();
    newVersionWaiting();
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(switchToWaiting).toHaveBeenCalledOnce();
  });

  it("holds the switch during a workout", () => {
    const { updater, newVersionWaiting, switchToWaiting, reload } = setup();
    updater.setBusy(true);
    newVersionWaiting();
    expect(switchToWaiting).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once free when another tab applied the new version", () => {
    const { updater, otherTabApplied, switchToWaiting, reload } = setup();
    updater.setBusy(true);
    otherTabApplied();
    expect(reload).not.toHaveBeenCalled();
    updater.setBusy(false);
    expect(reload).toHaveBeenCalledOnce();
    expect(switchToWaiting).not.toHaveBeenCalled();
  });

  it("does not reload when the first worker takes over a first visit", () => {
    const { otherTabApplied, reload } = setup({ controlled: false });
    otherTabApplied();
    expect(reload).not.toHaveBeenCalled();
  });
});
