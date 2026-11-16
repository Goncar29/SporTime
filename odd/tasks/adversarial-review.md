Objective: an adversarial review of the whole SporTime project: two blind judges look for failures independently, each severe finding is first proven by a failing test (RED), then fixed.
Branch: feat/sign-out-erase (fixes as separate commits after T6 of sign-out-erase). Baseline tree: commit 6f934c9. Publish (merge, push, deploy) only with the user's OK, after this and sign-out-erase T6.

## Specs

- S1. User: "a su vez me gustaria probar algo, relizar test adversariales, ya que no es un proyecto tan grande me gustaria ver que podemos encontrar". Answers: scope "Todo el proyecto SporTime" — "Timer, guardado offline, cuenta, borrado de cuenta, reglas de Firestore, PWA, cierre de sesión."; format "Revisores adversariales + tests que lo prueben" — "Dos revisores ciegos buscan fallas por separado; cada hallazgo se confirma con un test que falla (RED) antes de arreglarlo."
  1. Two blind judges (Judgment Day) sweep the whole project independently and read-only at the baseline tree, and return candidate findings with location, severity, evidence class and user impact.
  2. Each severe finding (CRITICAL or BLOCKER) is reproduced by a test that fails before the fix; a finding no test can reproduce is reported as unconfirmed, not fixed.
  3. Confirmed findings are fixed with the smallest patch, at most two fix rounds; findings left after round two are escalated to the user. WARNING and SUGGESTION findings are reported, not fixed automatically.
  4. The result is reported as JUDGMENT: APPROVED or JUDGMENT: ESCALATED with the findings, tests and fixes.

## Tasks

- [x] T1 (S1.1) Blind judges A and B on the baseline tree. Route: jd-judge-a, jd-judge-b (background, together). Commit: none (read-only).
- [ ] T2 (S1.2, S1.3) Freeze the severe rows, RED test per row, fix round 1 (and round 2 if needed), re-judgment. Route: jd-fix-agent per Judgment Day. Risk: decided per finding. Commit: pending.
- [ ] T3 (S1.4) Final verification (unit, vp check, emulator e2e) and the judgment. Route: inline. Commit: pending.

## Log

- L1 (2026-11-16): "podemos publicar pero tratemos de resolver los pendientes, a su vez me gustaria probar algo, relizar test adversariales, ya que no es un proyecto tan grande me gustaria ver que podemos encontrar". Answers: "Después de resolver los pendientes (recomendado)"; "Todo el proyecto SporTime"; "Revisores adversariales + tests que lo prueben".
- L2 (2026-11-16): T1 done. Judges A (8 rows) and B (6 rows) returned. One severe row; frozen ledger for round 1, SHA-256 d92954efbe6380ed9e8179e9e04590991215e7ef258ab58783ccfb7cdf2e4251 (canonical JSON of the one-row array, sorted keys) of this row:
  {"id":"JD-B-001","lens":"judgment-day","location":"src/update/infrastructure/connectUpdates.ts:33","severity":"CRITICAL","status_at_freeze":"open","evidence_class":"inferential","evidence_claim":"startBrowserUpdates() runs at module top level (main.tsx) and passes navigator.serviceWorker as container; connectUpdates reads container.controller (line 33) and calls container.addEventListener (line 49) without checking that it exists. Where navigator.serviceWorker is undefined (iOS in-app WKWebView browsers such as Instagram or Facebook, older Firefox private windows, plain http) this throws a TypeError while the entry module loads, so createRoot never runs and the user sees only the dark background, with no sign-in screen, timer or error."}
  Parent spot check: src/update/infrastructure/browserUpdates.ts:15 passes navigator.serviceWorker straight to connectUpdates, which reads .controller at connectUpdates.ts:33 with no guard.
  Informational rows (not fixed automatically; for the user's decision):
  - JD-A-001 + JD-B-002 (both judges) WARNING src/shared/application/outbox.ts:93: a deleted workout or history entry can come back: send() falls back to the stale draft (?? draft) after remove() cancelled it during has(id), so setDoc runs after deleteDoc and recreates it on the server (also after deleteAccount's discard).
  - JD-A-002 + JD-B-003 (both judges) WARNING src/account/application/deleteAccount.ts:19: account deletion takes no cross-tab lock and does not block writes: a save or finished session (this tab while 'Deleting…', or another tab) can land after erase and before deleteUser, and stays on the server forever, unreachable.
  - JD-A-003 + JD-B-004 (both judges) WARNING src/shared/firebase/firestore.ts:90 and src/app/App.tsx:131: the page can go away mid sign-out (tab closed, or a PWA update reload, held only during a workout) after auth.signOut and before the cache clear; the clear-on-start marker is only written on failure, so the account's data stays on the device; an update reload mid deletion can leave an active account with erased data.
  - JD-A-004 WARNING src/shared/application/outbox.ts:107: send() drops the outbox entry by id even if another tab revised its draft after put sent the older one, so a cross-tab edit can be lost.
  - JD-A-005 WARNING src/shared/application/outbox.ts:160: outbox changes read-modify-write the whole localStorage list with no cross-tab lock, so two tabs writing at once can drop a pending item.
  - JD-A-006 + JD-B-005 (both judges) WARNING/SUGGESTION src/timer/infrastructure/browserTimerAdapters.ts:106-110: two overlapping wakeLock requests (quick pause/resume) leak the first sentinel, so the screen stays on after the workout ends.
  - JD-A-007 SUGGESTION src/timer/domain/session.ts:40: a pause in the last 100 ms leaves the session paused past its end; exiting then never records it in history.
  - JD-A-008 + JD-B-006 (both judges) SUGGESTION firebase.json:37: the CSP only sets frame-ancestors; no script-src, connect-src or object-src defense in depth.
