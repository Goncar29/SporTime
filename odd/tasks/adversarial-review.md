Objective: an adversarial review of the whole SporTime project: two blind judges look for failures independently, each severe finding is first proven by a failing test (RED), then fixed.
Branch: feat/sign-out-erase (fixes as separate commits after T6 of sign-out-erase). Baseline tree: commit 6f934c9. Publish (merge, push, deploy) only with the user's OK, after this and sign-out-erase T6.

## Specs

- S1. User: "a su vez me gustaria probar algo, relizar test adversariales, ya que no es un proyecto tan grande me gustaria ver que podemos encontrar". Answers: scope "Todo el proyecto SporTime" — "Timer, guardado offline, cuenta, borrado de cuenta, reglas de Firestore, PWA, cierre de sesión."; format "Revisores adversariales + tests que lo prueben" — "Dos revisores ciegos buscan fallas por separado; cada hallazgo se confirma con un test que falla (RED) antes de arreglarlo."
  1. Two blind judges (Judgment Day) sweep the whole project independently and read-only at the baseline tree, and return candidate findings with location, severity, evidence class and user impact.
  2. Each severe finding (CRITICAL or BLOCKER) is reproduced by a test that fails before the fix; a finding no test can reproduce is reported as unconfirmed, not fixed.
  3. Confirmed findings are fixed with the smallest patch, at most two fix rounds; findings left after round two are escalated to the user. WARNING and SUGGESTION findings are reported, not fixed automatically.
  4. The result is reported as JUDGMENT: APPROVED or JUDGMENT: ESCALATED with the findings, tests and fixes.

## Tasks

- [ ] T1 (S1.1) Blind judges A and B on the baseline tree. Route: jd-judge-a, jd-judge-b (background, together). Commit: none (read-only).
- [ ] T2 (S1.2, S1.3) Freeze the severe rows, RED test per row, fix round 1 (and round 2 if needed), re-judgment. Route: jd-fix-agent per Judgment Day. Risk: decided per finding. Commit: pending.
- [ ] T3 (S1.4) Final verification (unit, vp check, emulator e2e) and the judgment. Route: inline. Commit: pending.

## Log

- L1 (2026-11-16): "podemos publicar pero tratemos de resolver los pendientes, a su vez me gustaria probar algo, relizar test adversariales, ya que no es un proyecto tan grande me gustaria ver que podemos encontrar". Answers: "Después de resolver los pendientes (recomendado)"; "Todo el proyecto SporTime"; "Revisores adversariales + tests que lo prueben".
