import { describe, expect, it, vi } from "vite-plus/test";
import { createBrowserInstall } from "./browserInstall";

interface Environment {
  standalone?: boolean;
  userAgent?: string;
  maxTouchPoints?: number;
}

function environment({
  standalone = false,
  userAgent = "Mozilla/5.0 (Linux; Android 15) Chrome/140",
  maxTouchPoints = 5,
}: Environment = {}) {
  const target = new EventTarget();
  return Object.assign(target, {
    matchMedia: () => ({ matches: standalone }),
    navigator: { userAgent, maxTouchPoints, standalone: undefined as boolean | undefined },
  });
}

/** What Chrome hands the page when it is willing to install it. */
function installEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  return Object.assign(event, {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
}

describe("createBrowserInstall", () => {
  it("has nothing to offer until the browser says it can install", () => {
    expect(createBrowserInstall(environment()).state()).toBe("unavailable");
  });

  it("keeps the browser's own banner away and offers the install itself", () => {
    const env = environment();
    const install = createBrowserInstall(env);
    const listener = vi.fn();
    install.subscribe(listener);
    const event = installEvent("accepted");

    env.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(install.state()).toBe("prompt");
    expect(listener).toHaveBeenCalled();
  });

  it("shows the browser's install dialog once and reports the answer", async () => {
    const env = environment();
    const install = createBrowserInstall(env);
    const event = installEvent("dismissed");
    env.dispatchEvent(event);

    await expect(install.install()).resolves.toBe("dismissed");
    expect(event.prompt).toHaveBeenCalledOnce();
    // Chrome allows one prompt per event, so nothing is left to offer until it sends another.
    expect(install.state()).toBe("unavailable");
  });

  it("knows the app is installed once the browser says so", () => {
    const env = environment();
    const install = createBrowserInstall(env);
    env.dispatchEvent(installEvent("accepted"));
    env.dispatchEvent(new Event("appinstalled"));
    expect(install.state()).toBe("installed");
  });

  it("knows it runs installed when opened from its icon", () => {
    expect(createBrowserInstall(environment({ standalone: true })).state()).toBe("installed");
    const ios = environment({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" });
    ios.navigator.standalone = true;
    expect(createBrowserInstall(ios).state()).toBe("installed");
  });

  it("offers the steps on an iPhone, which has no install dialog", async () => {
    const install = createBrowserInstall(
      environment({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }),
    );
    expect(install.state()).toBe("ios");
    await expect(install.install()).resolves.toBe("unavailable");
  });
});
