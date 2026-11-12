Objective: every failed save, delete or load tells the user what happened and logs its cause for the developer, before publishing.
Branch: fix/error-messages, from main at 2cc966a. Delivery strategy: ask-on-risk; publish only with the user's OK. Test runner: `npx pnpm@10 exec vp test run`, plus the Chrome and emulator end-to-end suites.

## Specs

- S1. "tengamos en cuenta que los mensajes http sean correctos y que den un mensaje correspondiente sea tanto al desarrollador como al usuario"
- S2. Agreed proposal ("si me parece bien asi"):
  1. Developer: each failure is logged to the console with the operation and its code (for example `Updating a saved workout failed: not-found`), without personal data.
  2. User, by code: `not-found` → the workout no longer exists, deleted on another device; `permission-denied` → the server refused the change, update the app, write to us if it keeps happening; `unauthenticated` → the session expired, sign in again; `unavailable` / `deadline-exceeded` → no connection with the server, try again later; `resource-exhausted` → too many attempts, wait a moment; anything else → today's general message.
  3. Tests for each case, in the app and on the emulator (editing a deleted workout shows the "no longer exists" message).
- Facts: Firestore reports `FirestoreErrorCode` values over WebChannel, not HTTP statuses. Today the code is dropped in `App.tsx` (save, update, delete), `recordFinishedSessions` (session save), `useLiveList` (list loads) and `HistoryScreen` (session delete).
- Copy: neutral Spanish (tú), like the rest of the app.

## Tasks

- [x] T1 (S1, S2) Map codes to failure kinds, log operation and code, show the kind's message in every save, delete and load path; tests; emulator test for the deleted workout. Route: inline. Risk: none (messages, logs, and a read after a refused update). Commit: see L3.

## Log

- L1 (2026-11-12): "antes de publicar dame evidencia que todo funciona y por ejemplo si hay problemas como la observacion que dices eso proviene por en mensaje de error http me imagino si no lo es aun asi tengamos en cuenta que los mensajes http sean correctos y que den un mensaje correspindiente sea tanto al desarrollador como al usuario"
- L2 (2026-11-12): Evidence on main f70a9f0 recorded in odd/tasks/pwa-install.md L7 (all suites green). Proposal accepted: "si me parece bien asi".
- L3 (2026-11-12): T1 done. `storeFailureKind`/`storeFailureCode` (domain), `reportStoreFailure`/`storeFailureMessage` (UI); wired in App (save, update, delete workout; finished session), `useLiveList(subscribe, operation)` (loads) and HistoryScreen (session delete). RED: 13 App tests and the domain test file. The emulator run then failed the deleted-workout test: the real server answers permission-denied, not not-found, because rules run before the existence check and the update rule reads resource.data. Fixed without changing rules: `update` asks `getDocFromServer` after a permission-denied and reports not-found when the workout is gone (RED 1 unit test, 3 branch tests). Checks: unit 361 of 361, typecheck 0, lint 0, Chrome e2e 20 of 20, emulator e2e 29 of 29 (the deleted-workout test now asserts the "no longer exists" message and the console line "Updating a saved workout failed: not-found").
