import { describe, expect, it } from "vite-plus/test";
import { initialsOf } from "./user";

describe("initialsOf", () => {
  it("uses the first letters of the first and last names", () => {
    expect(initialsOf("Carlos Gonzalez", "c@example.com")).toBe("CG");
    expect(initialsOf("ana maría de la cruz", "a@example.com")).toBe("AC");
  });

  it("uses one letter for a single name", () => {
    expect(initialsOf("Carlos", "c@example.com")).toBe("C");
  });

  it("falls back to the email when there is no name", () => {
    expect(initialsOf("   ", "zoe@example.com")).toBe("Z");
  });

  it("has a placeholder when there is neither", () => {
    expect(initialsOf("", "")).toBe("?");
  });
});
