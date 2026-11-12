import { describe, expect, it } from "vite-plus/test";
import { DISMISS_FOR_MS, isIos, shouldOfferInstall } from "./install";

const now = 1_800_000_000_000;

describe("shouldOfferInstall", () => {
  it("offers installing where the browser allows it, or the steps on an iPhone", () => {
    expect(shouldOfferInstall("prompt", null, now)).toBe(true);
    expect(shouldOfferInstall("ios", null, now)).toBe(true);
  });

  it("never offers it once installed, or where the browser cannot install", () => {
    expect(shouldOfferInstall("installed", null, now)).toBe(false);
    expect(shouldOfferInstall("unavailable", null, now)).toBe(false);
  });

  it("stays quiet for 30 days after 'Not now', then offers it again", () => {
    expect(shouldOfferInstall("prompt", now - DISMISS_FOR_MS + 1, now)).toBe(false);
    expect(shouldOfferInstall("prompt", now - DISMISS_FOR_MS, now)).toBe(true);
    expect(DISMISS_FOR_MS).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it("offers it again when the stored time is in the future, as after a clock change", () => {
    expect(shouldOfferInstall("prompt", now + 60_000, now)).toBe(true);
  });
});

describe("isIos", () => {
  it("recognizes iPhone, iPod and iPad, including iPads that report a Mac", () => {
    expect(
      isIos({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", maxTouchPoints: 5 }),
    ).toBe(true);
    expect(isIos({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0)", maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", maxTouchPoints: 5 })).toBe(
      true,
    );
  });

  it("does not mistake Android or a Mac computer for it", () => {
    expect(isIos({ userAgent: "Mozilla/5.0 (Linux; Android 15)", maxTouchPoints: 5 })).toBe(false);
    expect(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", maxTouchPoints: 0 })).toBe(
      false,
    );
  });
});
