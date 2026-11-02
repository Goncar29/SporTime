Objective: gym timer PWA with Google login and cloud-saved workouts and history.
Branch: feat/sportime-v1. Delivery strategy: exception-ok (new repository with no remote; each phase is a reviewable commit group). Test runner: `pnpm exec vp test`.
Node 24 (`.nvmrc`), pnpm, React + TypeScript, hexagonal architecture.

## Specs

- S1. Timer types: "temporizador de varios tipos, como cronometro, amrap, tabata, emom, etc."
- S2. Workout shapes: "en un tiempo determinado un entrenamiento sin parar o con pausas con varias sesiones o no"
- S3. Platform: "Web instalable (PWA)" that keeps timing without a network connection after first load.
- S4. Tooling: "me gustaria usar pnpm en lugar de npm", "arquitectura me parece bien hexagonal", "react + typescript". Vite+ if `vite-plugin-pwa` builds under it; plain Vite otherwise.
- S5. Design: "moderno, que genere energia y motivacion asique debe de ser dinamico pero rapido"
- S6. Login: "el usuario debe de hacer login con cuenta de google, solo debera pedir datos basicos como nombre, email y foto de perfil si tiene"
- S7. Cloud data: "guardar entrenamientos e historial en la nube con firestore"
- S8. Approved plan details: only finished sessions are saved to history; profile data stays in Firebase Auth; each user reads and writes only their own data; privacy notice and account deletion; timer never depends on the network once signed in. Deploy only with the user's OK.
- S9. Language: "vamos con i18n entre ambos idiomas" (English and Spanish).

## Tasks

- [x] T0 (S3, S4) Tooling: repository, Node 24, pnpm, Vite+, PWA build. Route: inline. Evidence: `vp build` exit 0, generates `dist/sw.js` with 8 precache entries.
- [x] T1 (S1, S2) Timer engine and workout modes. Route: inline. Evidence: `pnpm test` 62 passed, `pnpm typecheck` clean.
- [x] T2 (S1, S2, S5) Timer screen, design, sound, screen wake. Route: inline. Evidence: 73 unit tests and 8 Chrome end-to-end tests pass.
- [x] T2b (S9) English and Spanish with a language switcher. Route: inline. Evidence: 88 unit tests and 10 Chrome end-to-end tests pass, checked by exit code.
- [x] T3 (S6) Google login behind `AuthGateway`. Route: inline. Evidence: independent verifier recheck on 3e8b39e; the user completed a real Google login on 2026-11-02.
- [ ] T4 (S7, S8) Saved workouts, history, Firestore rules. Route: inline. Firestore database created by the user; Java 25 installed for the emulator.
- [ ] T5 (S3, S8) Offline, privacy notice, account deletion, deploy. Route: inline. Deploy needs the user's OK.

## Log

- L1 (2026-11-01, original request): "necesito que me ayudes a hacer una aplicacion para uso en un gimnasio, este sera para uso de temporizador de varios tipos, como cronometro, amrap, tabata, emom, etc. Esto quiere decir que tendra varios tipos de tiempo donde el usuario al entrenar pueda hacer en un tiempo determinado un entrenamiento sin parar o con pausas con varias sesiones o no"
- L2 (2026-11-01): "bien pero creo que deberiamos de pensar que tipo de arquietectura, tecnologias, herramientas, etc de como hacerlo antes de escribir codigo, deberiamos planificarlo mejor"
- L3 (2026-11-01): "bien, igual me gustaria usar pnpm en lugar de npm, creo que es mas rapido y seguro, la arquitectura me parece bien hexagonal, esta bien react + typescript, sobre vite que es mejor asi como dices o vite+?. sobre el dieño de la app me gustaria que fuese moderno, que genere energia y motivacion asique debe de ser dinamico pero rapido, el usuario debe de hacer login con cuenta de google, solo debera pedir datos basicos como nombre, email y foto de perfil si tiene"
- L4 (2026-11-01): "si, guardar entrenamientos e historial en la nube con firestore"
- L5 (2026-11-01): Plan approved: "si, crees que es mejor aplicar ODD?" Workflow confirmed as ODD.
- L6 (2026-11-01): `gentle-ai` CLI is not installed, so native review assessment is unavailable. Java is not installed, so the Firestore emulator cannot run yet.
- L7 (2026-11-01): "actualicemos node para que funcione o revisa si no esta instalado ya y es solo cambiar la version si esto genera problema". Node 24.21 was already installed; pinned in `.nvmrc`. The default nvm version was left unchanged.
- L8 (2026-11-01): The missing `sw.js` was not caused by Vite+: plain Vite 8 behaved the same. Native Rollup exits 132 (SIGILL) on this i7-3610QM, which lacks AVX2 and BMI. Fixed with a `@rollup/wasm-node` pnpm override.
- L9 (2026-11-01): T0 to T2 complete. T3 waits on the user creating a Firebase project; T4 rules tests also need Java. Next step: T3.
- L10 (2026-11-01): "vamos con i18n entre ambos idiomas". Typed dictionaries with no library; UI copy moves out of the domain.
- L11 (2026-11-01): Correction: earlier "73 tests pass" reports hid a failing `pnpm test` exit because Vitest was also collecting the Playwright spec. Fixed by restricting Vitest `include`. Checks are now judged by exit code.
- L12 (2026-11-01): User provided the Firebase web config. Google Analytics from the setup snippet was left out because S6 asks for basic data only. Fake auth gateway exists for end-to-end tests and only loads in `--mode e2e` builds.
- L13 (2026-11-01): T3 code complete with a fake gateway. A real Google login still needs the user: enable the Google provider and try it. Risk: item 2 (auth), independent verifier required.
- L14 (2026-11-01): Independent verifier on d68a0be: 3 blockers. B1 sign-in button stuck after back-forward restore from a redirect. B2 stalled network blanks a signed-in user for 30-60 s because `onAuthStateChanged` waits for an account lookup. B3 offline popup failure reports the unknown message. One correction batch: `pageshow` reset, `withCachedSession` snapshot, offline mapping. S8 note: name, email and photo URL are now also cached in this device's localStorage until sign-out (never in Firestore); this must appear in the T5 privacy notice.
- L15 (2026-11-01): Verifier recheck on 3e8b39e: B1, B2 and B3 fixed for their reported cases (stalled start 30.5 s to 239 ms; ended sessions still lock). Known limits, not corrected: a stalled load with no snapshot yet still takes about 30 s once; an unreachable network with `navigator.onLine=true` shows the generic message; sign-out during a stalled start is untested. T3 stays open until the user completes a real Google login. Next: T4.
- L16 (2026-11-02): "si, entro con mi cuenta de google, ya instale java pero chquea si es la version recomendada ya que hubieron grandes riesgos de seguridad segun los medios en estas ultimas semanas". T3 closed. The user also created the Firestore database (Standard edition, production mode).
- L17 (2026-11-02): Java check: OpenJDK 25.0.4.1 from Ubuntu 26.04, the newest in its archive. The OpenJDK advisory of 2026-10-20 lists 25.0.4.1 and earlier as affected (highest CVSS 7.0) and no Ubuntu October update was found. For the CVSS 9.1 eMudhra issue, Ubuntu marks CVE-2026-91403 as not affected, while openjdk.org/emudhra asks Debian-derived systems for a manual workaround; the trust store holds `emsign_root_ca_-_g1`, one of the four named roots. Java is used only for the local Firestore emulator and does not ship with the app. Next: T4, waiting on the user's OK to use this Java.
- L18 (2026-11-02): "si, arranca T4". Decisions: `users/{uid}/workouts` and `users/{uid}/history` hold immutable documents (create, read, delete only), with the shape enforced by the rules and the numeric limits checked against the domain `LIMITS` by a test. Rules tests run on `demo-sportime`, which reaches no real project; `re2` stays without a build script. Deploying the rules needs the user's OK and login, and until then the real project denies all access.
