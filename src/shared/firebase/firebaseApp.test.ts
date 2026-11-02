import { describe, expect, it } from "vite-plus/test";
import { authDomainFor } from "./firebaseApp";

describe("authDomainFor", () => {
  it("uses the app's own domain on Firebase Hosting so redirects survive blocked third-party storage", () => {
    expect(authDomainFor("sportime-4dc6e.web.app")).toBe("sportime-4dc6e.web.app");
  });

  it("uses the project auth domain everywhere else", () => {
    expect(authDomainFor("localhost")).toBe("sportime-4dc6e.firebaseapp.com");
    expect(authDomainFor("sportime-4dc6e.web.app.evil.example")).toBe(
      "sportime-4dc6e.firebaseapp.com",
    );
  });
});
