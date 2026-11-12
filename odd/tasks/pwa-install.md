Objective: tell visitors they can install Sportime as an app, and let them do it from the page.
Branch: feat/pwa-install, from main at 404c982. Delivery strategy: ask-on-risk; push, merge and deploy only with the user's OK. Test runner: `npx pnpm@10 exec vp test run`, plus the Chrome end-to-end suite.

## Specs

- S1. "hoy el usuario no sabe que puedes instalar la web como app en el celular asique estaria bueno que al usuario al entrar a la web le aparezca una opcion de instalar si lo desea"
- S2. Agreed behavior ("exacto eso es lo que busco"):
  1. On entering the site, a small dismissible notice at the top: "Instalá Sportime en tu celular" with Install and "Ahora no". On iPhone, which has no install button, the notice gives the steps (Share, then "Agregar a inicio") instead.
  2. "Ahora no" hides it for 30 days.
  3. Profile always keeps an "Instalar app" option, in case someone dismissed it and changes their mind.
  4. Nothing shows when the app is already installed or opened from its icon.
- Assumptions: "on entering" means the first screen, so the notice shows on the sign-in screen and at the top of the Timer tab, never over a running workout. Browsers that neither offer installing nor are iOS (for example Firefox on a computer) show nothing.

## Tasks

- [x] T1 (S1, S2) Install state from the browser (beforeinstallprompt, appinstalled, standalone, iOS), the 30-day dismissal, the notice on sign-in and Timer, the Profile option, i18n. Route: inline. Risk: none (UI and a local preference only). Commit: see L3.

## Log

- L1 (2026-11-12): "despues en otra rama trabajaremos con la opcion de PWA hoy el usuario no sabe que puedes instalar la web como app en el celular asique estaria bueno que al usuario al entrar a la web le aparezca una opcion de instalar si lo desea"
- L2 (2026-11-12): The app was already installable (manifest, icons, service worker via vite-plugin-pwa); only discovery was missing. Proposal accepted: "exacto eso es lo que busco".
- L3 (2026-11-12): T1 done. New `src/install` module: domain (`shouldOfferInstall`, 30 days, `isIos` incl. iPads reporting a Mac), port, browser adapter (beforeinstallprompt captured in main.tsx before any await, appinstalled, standalone and `navigator.standalone`), localStorage dismissals, `InstallProvider` (no provider means nothing to install, so other tests are unaffected), `InstallBanner` on sign-in and Timer, `InstallOption` on Profile. RED: module imports missing, then GREEN. Checks: unit 328 of 328, typecheck 0, lint 0 (ports declared as function properties, per cb974fd), Chrome e2e 20 of 20 (3 new: offer and dialog, Not now across a reload plus Profile, iPhone steps), emulator e2e 29 of 29. Phone screenshots checked (sign-in Android, Timer iPhone). Not merged, pushed or deployed.
