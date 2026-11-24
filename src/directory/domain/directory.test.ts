// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { DIRECTORY_LIMITS, directoryEntryFor, isGooglePhoto, normalizeEmail } from "./directory";

const user = {
  id: "u1",
  name: "Ana Pérez",
  email: "Ana@Example.com",
  photoUrl: "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
};

describe("normalizeEmail", () => {
  it("trims and lowercases, so one address has one directory entry", () => {
    expect(normalizeEmail("  Ana.Perez@Gmail.COM \n")).toBe("ana.perez@gmail.com");
    expect(normalizeEmail("ana@example.com")).toBe("ana@example.com");
    expect(normalizeEmail("   ")).toBe("");
  });
});

describe("isGooglePhoto", () => {
  it("accepts an https address on googleusercontent.com", () => {
    expect(isGooglePhoto("https://lh3.googleusercontent.com/a/x=s96-c")).toBe(true);
    expect(isGooglePhoto("https://googleusercontent.com/a")).toBe(true);
  });

  it("refuses any other scheme, host, credentials, port or look-alike", () => {
    for (const url of [
      "http://lh3.googleusercontent.com/a",
      "https://evil.com/lh3.googleusercontent.com/a",
      "https://lh3.googleusercontent.com.evil.com/a",
      "https://evilgoogleusercontent.com/a",
      "https://user@lh3.googleusercontent.com/a",
      "https://lh3.googleusercontent.com:8080/a",
      "https://lh3.googleusercontent.com",
      "https://lh3.googleusercontent.com/a b",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isGooglePhoto(url), url).toBe(false);
    }
  });

  it("refuses an address longer than the limit", () => {
    const base = "https://lh3.googleusercontent.com/";
    const longest = base + "a".repeat(DIRECTORY_LIMITS.photoLength - base.length);
    expect(isGooglePhoto(longest)).toBe(true);
    expect(isGooglePhoto(`${longest}a`)).toBe(false);
  });
});

describe("directoryEntryFor", () => {
  it("keeps the uid, Google name and Google photo", () => {
    expect(directoryEntryFor(user)).toEqual({
      uid: "u1",
      name: "Ana Pérez",
      photo: "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
    });
  });

  it("leaves the photo empty when it is missing or not from googleusercontent.com", () => {
    expect(directoryEntryFor({ ...user, photoUrl: null }).photo).toBe("");
    expect(directoryEntryFor({ ...user, photoUrl: "https://example.com/me.png" }).photo).toBe("");
  });

  it("leaves the name empty when Google gave none, rather than repeating the email", () => {
    expect(directoryEntryFor({ ...user, name: "Ana@Example.com" }).name).toBe("");
    expect(directoryEntryFor({ ...user, name: "   " }).name).toBe("");
  });

  it("keeps the name on one line, well formed and within the limit", () => {
    expect(directoryEntryFor({ ...user, name: " Ana\nPérez\u0000 " }).name).toBe("Ana Pérez");
    expect(directoryEntryFor({ ...user, name: "Ana\uD800" }).name).toBe("Ana");
    const long = directoryEntryFor({ ...user, name: "💪".repeat(60) }).name;
    expect(long.length).toBeLessThanOrEqual(DIRECTORY_LIMITS.nameLength);
    expect(long).toBe("💪".repeat(50));
  });
});
