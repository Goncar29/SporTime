// @vitest-environment node
import firebaseConfig from "../../../firebase.json";
import indexHtml from "../../../index.html?raw";
import { authDomainFor } from "../firebase/firebaseApp";

interface HeaderRule {
  source?: string;
  regex?: string;
  headers: { key: string; value: string }[];
}

const rules: HeaderRule[] = firebaseConfig.hosting.headers;

/** The rule that protects the app's pages: the one that sends the Content-Security-Policy. */
function pageRule(): HeaderRule {
  const rule = rules.find(({ headers }) =>
    headers.some(({ key }) => key === "Content-Security-Policy"),
  );
  if (!rule) throw new Error("No hosting rule sends a Content-Security-Policy");
  return rule;
}

function header(rule: HeaderRule, key: string): string | undefined {
  return rule.headers.find((entry) => entry.key === key)?.value;
}

function policy(): Map<string, string[]> {
  const value = header(pageRule(), "Content-Security-Policy") ?? "";
  return new Map(
    value
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name ?? "", sources]),
  );
}

/** Hosting matches the regex against the path only. */
const coversPath = (path: string) => new RegExp(pageRule().regex ?? "$^").test(path);

describe("hosting headers", () => {
  it("sends a full policy that allows only what the app loads", () => {
    expect(Object.fromEntries(policy())).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://apis.google.com"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "font-src": ["'self'"],
      "img-src": ["'self'", "https://*.googleusercontent.com", "https://www.google.com"],
      "connect-src": [
        "'self'",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "https://firestore.googleapis.com",
      ],
      "frame-src": ["'self'", "https://sportime-4dc6e.firebaseapp.com"],
      "worker-src": ["'self'"],
      "manifest-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
      "frame-ancestors": ["'none'"],
    });
  });

  it("never lets inline or evaluated scripts run", () => {
    const scripts = policy().get("script-src");

    expect(scripts).toBeDefined();
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).not.toContain("data:");
    expect(scripts).not.toContain("*");
  });

  it("needs no inline script: the page's only script without a file is data", () => {
    const inlineScripts = [...indexHtml.matchAll(/<script\b([^>]*)>/g)]
      .map(([, attributes]) => attributes ?? "")
      .filter((attributes) => !/\ssrc=/.test(attributes));

    expect(inlineScripts).toEqual([' type="application/ld+json"']);
  });

  it("lets the page frame the Google sign-in helper from the project's auth domain", () => {
    const frames = policy().get("frame-src");

    // On the hosting domains the helper is on the app's own origin; elsewhere on the project's domain.
    expect(authDomainFor("sportime-4dc6e.web.app")).toBe("sportime-4dc6e.web.app");
    expect(frames).toContain("'self'");
    expect(frames).toContain(`https://${authDomainFor("localhost")}`);
  });

  it("allows every origin the page connects to ahead of time", () => {
    const preconnected = [...indexHtml.matchAll(/rel="preconnect" href="([^"]+)"/g)].map(
      ([, href]) => href,
    );
    const allowed = [...(policy().get("script-src") ?? []), ...(policy().get("frame-src") ?? [])];

    expect(preconnected.length).toBeGreaterThan(0);
    for (const origin of preconnected) expect(allowed).toContain(origin);
  });

  it("still forbids every site from framing the app", () => {
    expect(policy().get("frame-ancestors")).toEqual(["'none'"]);
    expect(header(pageRule(), "X-Frame-Options")).toBe("DENY");
  });

  it("still leaves Firebase's own sign-in pages under /__/ without the app's policy", () => {
    for (const path of ["/", "/index.html", "/sw.js", "/assets/index.js", "/_", "/_x", "/x__"]) {
      expect(coversPath(path), path).toBe(true);
    }
    for (const path of ["/__/auth/iframe", "/__/auth/handler", "/__/firebase/init.json"]) {
      expect(coversPath(path), path).toBe(false);
    }
  });

  it("still sends nosniff, the referrer policy and the cache rules", () => {
    expect(header(pageRule(), "X-Content-Type-Options")).toBe("nosniff");
    expect(header(pageRule(), "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(rules.find((rule) => rule.source === "**")?.headers).toEqual([
      { key: "Cache-Control", value: "no-cache" },
    ]);
    expect(rules.find((rule) => rule.source === "/assets/**")?.headers).toEqual([
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ]);
  });
});
