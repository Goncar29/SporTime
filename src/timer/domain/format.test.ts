import { describe, expect, it } from "vite-plus/test";
import { formatClock } from "./format";

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_000)).toBe("01:05");
  });

  it("adds hours only when needed", () => {
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });

  it("floors by default so a count-up never shows time not yet reached", () => {
    expect(formatClock(1_999)).toBe("00:01");
  });

  it("rounds up for countdowns so zero appears only at the end", () => {
    expect(formatClock(1, "ceil")).toBe("00:01");
    expect(formatClock(2_000, "ceil")).toBe("00:02");
  });
});
