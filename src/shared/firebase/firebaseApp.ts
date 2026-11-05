import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";

const PROJECT_AUTH_DOMAIN = "sportime-4dc6e.firebaseapp.com";
/** The live site and its preview channels, which Hosting names `<site>--<channel>-<hash>.web.app`. */
const HOSTING_DOMAIN = /^sportime-4dc6e(--[a-z0-9-]+)?\.web\.app$/;

/**
 * Serving the auth handler from the app's own domain keeps redirect sign-in
 * working in browsers that block third-party storage.
 */
export function authDomainFor(hostname: string): string {
  return HOSTING_DOMAIN.test(hostname) ? hostname : PROJECT_AUTH_DOMAIN;
}

/** These values identify the project and are public by design: access is enforced by security rules. */
export function firebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp({
    apiKey: "AIzaSyB6a25fjJQgJif1aBVXr9Y2otukORuCME4",
    authDomain: authDomainFor(location.hostname),
    projectId: "sportime-4dc6e",
    storageBucket: "sportime-4dc6e.firebasestorage.app",
    messagingSenderId: "848941891940",
    appId: "1:848941891940:web:835d12bcef7e50af7d7a71",
  });
}
