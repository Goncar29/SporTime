import { describe, expect, it } from "vite-plus/test";
import { authDomainFor } from "./firebaseApp";

describe("authDomainFor", () => {
  it("uses the app's own domain on Firebase Hosting so redirects survive blocked third-party storage", () => {
    expect(authDomainFor("sportime-4dc6e.web.app")).toBe("sportime-4dc6e.web.app");
  });

  it("does the same on this site's preview channels", () => {
    const preview = "sportime-4dc6e--sound-settings-icmub5i8.web.app";
    expect(authDomainFor(preview)).toBe(preview);
  });

  it("does not mistake other sites for a preview channel", () => {
    for (const hostname of [
      "sportime-4dc6e--x.web.app.evil.example",
      "evil.sportime-4dc6e--x.web.app",
      "sportime-4dc6e-x.web.app",
      "sportime-4dc6e--.web.app",
      "other--x.web.app",
    ]) {
      expect(authDomainFor(hostname)).toBe("sportime-4dc6e.firebaseapp.com");
    }
  });

  it("uses the project auth domain everywhere else", () => {
    expect(authDomainFor("localhost")).toBe("sportime-4dc6e.firebaseapp.com");
    expect(authDomainFor("sportime-4dc6e.web.app.evil.example")).toBe(
      "sportime-4dc6e.firebaseapp.com",
    );
  });
});
