import { describe, expect, it } from "vite-plus/test";
import { storeFailureCode, storeFailureKind } from "./storeFailure";

const failure = (code: string) => Object.assign(new Error("refused"), { code });

describe("storeFailureKind", () => {
  it.each([
    ["not-found", "notFound"],
    ["permission-denied", "denied"],
    ["unauthenticated", "sessionEnded"],
    ["unavailable", "offline"],
    ["deadline-exceeded", "offline"],
    ["resource-exhausted", "busy"],
    ["internal", "unknown"],
    ["aborted", "unknown"],
  ])("reads Firestore's %s as %s", (code, kind) => {
    expect(storeFailureKind(failure(code))).toBe(kind);
  });

  it("also reads codes Firebase prefixes with the service name", () => {
    expect(storeFailureKind(failure("firestore/permission-denied"))).toBe("denied");
  });

  it("treats anything without a code as unknown", () => {
    expect(storeFailureKind(new Error("boom"))).toBe("unknown");
    expect(storeFailureKind("boom")).toBe("unknown");
    expect(storeFailureKind(null)).toBe("unknown");
  });
});

describe("storeFailureCode", () => {
  it("gives the code for the developer, or nothing", () => {
    expect(storeFailureCode(failure("not-found"))).toBe("not-found");
    expect(storeFailureCode(new Error("boom"))).toBeUndefined();
  });
});
