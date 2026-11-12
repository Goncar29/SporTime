Objective: let users edit a saved workout (name, mode, times, rounds, round names) instead of only loading or deleting it.
Branch: feat/edit-saved-workouts, from feat/tab-navigation at d5bd485. Delivery strategy: ask-on-risk; rules publish, push, merge and deploy only with the user's OK (rules before the app). Test runner: `npx pnpm@10 exec vp test run`; rules with `test:rules` on the emulator; Chrome and emulator end-to-end suites.

## Specs

- S1. "loe entrenamientos guardados que tengan la opcion de editar, hoy no las tienen" — in another branch: "en otra rama para no mezclar".
- S2. Scope ("si" to everything): name, times and counts, round names and the workout type can all be edited. Flow: an Edit button per saved workout opens Timer with it loaded; the save area shows saving changes to that workout, plus cancel.
- S3. Storage ("vamos por la opcion 1"): Firestore rules allow updating one's own saved workout when the result passes the same validation as creating it and `createdAt` is unchanged, so it keeps its place in the list. One write, works offline. History entries stay immutable.
- Constraint: the new rules must be published before the app that edits, or the server refuses edits.

## Tasks

- [x] T1 (S3) Rules allow a validated update with unchanged `createdAt`; rules tests. Route: inline. Risk: item 2 (security rules). Commit: 8471a18.
- [x] T2 (S1, S2) `WorkoutLibrary.update` (Firestore, outbox draft kept in step, fake), Edit button on Saved, editing state on Timer's save form, i18n. Route: inline. Risk: item 1 (changes stored workouts). Commit: see L5.
- [x] T3 (S1-S3) End-to-end: an edit reaches the server and keeps its place. Route: inline.

## Log

- L1 (2026-11-12): "me gusta y funciona bien pero hay algo que me gustaria agregar pero en otra rama para no mezclar, loe entrenamientos guardados que tengan la opcion de editar, hoy no las tienen"
- L2 (2026-11-12): Scope question; "a la configuracion a que te refieres? a los tiempos de preparacion, descanso, series, etc o el tipo de entrenamiento?" then "si" to editing everything, including the type.
- L3 (2026-11-12): Today's rules only accept an identical rewrite (`firestore/firestore.rules:74`). Options: change the rules (one write) or replace (create + delete, two writes, duplicate risk). "vamos por la opcion 1".
- L4 (2026-11-12): Noted for later, separate branch: "despues en otra rama trabajaremos con la opcion de PWA hoy el usuario no sabe que puedes instalar la web como app en el celular asique estaria bueno que al usuario al entrar a la web le aparezca una opcion de instalar si lo desea"
- L5 (2026-11-12): T1: RED 3 rules tests; workout and history immutability tests split since workouts are now editable; deliberate breaks (dropping the createdAt check, dropping the shape check) each caught; rules 51 of 51 on the emulator. T2/T3: RED 2 outbox and 5 App tests; `WorkoutLibrary.update` writes with setDoc over the same id and revises a pending outbox draft; Edit button on Saved; editing notice under the Timer title (moved there after a phone screenshot showed it below the fold); Save changes / Cancel; loading another workout or deleting the edited one ends editing. Checks: unit 304 of 304, typecheck 0, lint 0, Chrome e2e 17 of 17, emulator e2e 28 of 28 (new: an edit reaches the server over the same document with the same createdAt). Next: independent verifier and native review (items 1 and 2), then rules publish before the app, with the user's OK.
- L6 (2026-11-12): Independent verifier on 49f7975: S1-S3 pass, no blockers; 7 rules probes (P1-P7) on the emulator all as expected. Advisories: an offline edit can recreate a workout deleted on another device (setDoc on a missing doc is a create, last write wins); a millisecond race where a flush already past the cache check sends the old version after an edit; an edit is not outbox-protected during the slow auth start-up (same as remove); typing a name while the workout is deleted loses the typed name.
