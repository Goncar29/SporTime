import { describe, expect, it, vi } from "vite-plus/test";
import { createAppUpdater } from "./appUpdater";

describe("createAppUpdater", () => {
  it("applies a new version as soon as it is ready", () => {
    const apply = vi.fn();
    const updater = createAppUpdater(apply);
    expect(apply).not.toHaveBeenCalled();
    updater.ready();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("holds a new version back while busy and applies it once free", () => {
    const apply = vi.fn();
    const updater = createAppUpdater(apply);
    updater.setBusy(true);
    updater.ready();
    expect(apply).not.toHaveBeenCalled();
    updater.setBusy(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does nothing when free again with no new version", () => {
    const apply = vi.fn();
    const updater = createAppUpdater(apply);
    updater.setBusy(true);
    updater.setBusy(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies a version only once", () => {
    const apply = vi.fn();
    const updater = createAppUpdater(apply);
    updater.ready();
    updater.ready();
    updater.setBusy(true);
    updater.setBusy(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
