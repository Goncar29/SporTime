Objective: close the gaps found by the live release check and the known limits of sportime-v1, and add custom interval names.
Branch: feat/hardening-and-interval-names, from main at 1e0249d. Delivery strategy: ask-on-risk; push, merge and deploy only with the user's OK. Test runner: `pnpm test` (Node 24).
Engram mirror: unavailable in this session (no memory tools callable); this file is the only record.

## Specs

- S1. Account deletion re-confirmation: "elegir la cuenta". Google must show the account chooser (`prompt: "select_account"`) before deletion, as sign-in already does, so deletion never completes without the user choosing an account.
- S2. Privacy notice contact: "carlosngonzalez0@gmail.com".
- S3. Skipped phases: "dejarlo como un entrenamiento mas pero pongamos en la lista de los entrenamientos un boton de borrar por si el usuario quiera y que aparezca un modal de aviso por si lo quiere hacer realmente"
  Refined in L5: both History and Saved workouts get the modal; Saved workouts replaces its browser confirm.
- S4. Orphan data after deletion from another tab or device: "Limpieza en servidor" (a Cloud Function that erases the user's data when the account is deleted; needs the Blaze plan and a functions deploy).
- S5. "Corregir las 77 advertencias" of `vp check`.
- S6. "Nombres de intervalo propios": "Un nombre por ronda" (shown and spoken for the work phase of each round; rests keep their default names); an unnamed round uses "El nombre por defecto".

## Tasks

- [x] T1 (S1) Deletion re-confirmation shows the account chooser. Route: inline. Risk: item 1 and item 2. Evidence: RED `{}` vs `{ prompt: "select_account" }` for popup and redirect fallback, then GREEN; typecheck 0; `vp check` 0 errors. Commit: see L5.
- [ ] T2 (S2) Contact email in the privacy notice (both languages). Route: inline.
- [ ] T3 (S3) Delete button with a confirmation modal in the history list. Route: inline. Risk: item 1 (deleting stored data, requested).
- [ ] T4 (S4) Server cleanup on account deletion. Route: inline. Risk: item 1 and item 5. Needs the user to enable Blaze; deploy only with the user's OK.
- [ ] T5 (S5) Fix `vp check` warnings. Route: inline.
- [ ] T6 (S6) Custom interval names. Route: inline. Needs product decisions first.

## Log

- L1 (2026-11-10, original request): "elegir la cuenta, ya arreglemos eso y los demas puntos que mencionaste sobre limitaciones conocidas"
- L2 (2026-11-10): Live check with ego lite on `sportime-4dc6e.web.app`. Desktop sign-in works. On the delete screen, 301 s after sign-in, "Delete my account" opened the Google popup, which closed by itself with no user action, and the account was deleted: after signing in again, `createdAt` was 18:15:32Z, 17 s earlier. Cause: `firebaseAccountIdentity.ts` reauthenticates with a `GoogleAuthProvider` without `prompt: "select_account"`, so Google silently re-confirms a single consented session; sign-in sets that prompt and waited for a choice. The emulator never exercised this (sportime-v1 L27).
- L3 (2026-11-10): Answers: contact "carlosngonzalez0@gmail.com"; skipped phases as in S3; orphan data "Limpieza en servidor"; also "Corregir las 77 advertencias" and "Nombres de intervalo propios".
- L4 (2026-11-10): Environment: global `core.autocrlf=true` checked the files out with CRLF, so `vp check` flagged formatting on every file. Set repo-local `core.autocrlf=false` and `core.eol=lf` and converted the working tree to LF; content diff unchanged. Binary icons briefly touched by the conversion were restored from Git and verified as PNG. On this machine the full suite times out 4 UI tests at 5 s (App, SignedInApp); the same files pass with `--testTimeout=30000` (46 of 46), so they are load timeouts, not regressions.
- L5 (2026-11-10): Answers: delete with a modal in both "Historial" and "Entrenamientos guardados" (replacing `window.confirm`); interval names "Un nombre por ronda" (the work phase of each round; rests keep their default name); an unnamed round uses "El nombre por defecto". T1 committed.
