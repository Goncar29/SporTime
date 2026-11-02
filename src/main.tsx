import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-800-italic.css";
import "./app/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import type { AuthGateway } from "./auth/application/ports";
import { AccountMenu } from "./auth/ui/AccountMenu";
import { AuthGate } from "./auth/ui/AuthGate";
import { localStorageLanguageStore } from "./i18n/infrastructure/localStorageLanguageStore";
import { I18nProvider } from "./i18n/ui/I18nProvider";
import {
  createWakeLockScreenAwake,
  createWebAudioCuePlayer,
  systemClock,
} from "./timer/infrastructure/browserTimerAdapters";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

const timer = {
  clock: systemClock,
  cues: createWebAudioCuePlayer(),
  screenAwake: createWakeLockScreenAwake(),
};

// Decided at build time, so the fake gateway is never shipped in a production build.
async function createAuthGateway(): Promise<AuthGateway> {
  if (import.meta.env.VITE_FAKE_AUTH === "true") {
    const { createFakeAuthGateway } = await import("./auth/infrastructure/fakeAuthGateway");
    return createFakeAuthGateway();
  }
  const { createFirebaseAuthGateway } = await import("./auth/infrastructure/firebaseAuthGateway");
  return createFirebaseAuthGateway();
}

const authGateway = await createAuthGateway();

createRoot(root).render(
  <StrictMode>
    <I18nProvider store={localStorageLanguageStore} browserLanguages={navigator.languages}>
      <AuthGate gateway={authGateway}>
        <App timer={timer} account={<AccountMenu />} />
      </AuthGate>
    </I18nProvider>
  </StrictMode>,
);
