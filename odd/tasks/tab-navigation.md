Objective: replace the single crowded home page with a bottom tab bar (Timer, Saved, History, Profile) that reads well on a phone.
Branch: feat/tab-navigation, from main at 32eb4ed. Delivery strategy: ask-on-risk; push and deploy only with the user's OK. Test runner: `npx pnpm@10 exec vp test run`, plus the Chrome and emulator end-to-end suites.

## Specs

- S1. "hoy esta todo en una pagina de inicio todo mezlado, me gustaria ordenar algunos elementos ya que en un celular se queda todo mas apretado"
- S2. Chosen layout ("si" to the tab bar proposal): a bottom tab bar "Timer · Guardados · Historial · Perfil". Profile holds photo, name, language, settings, privacy, sign out and delete account. The Timer tab keeps modes, settings and Start. Loading a saved workout from Saved opens the Timer tab with it loaded.
- S3. Modes as compact chips with only the name; the description shows for the selected mode only.
- S4. The running workout keeps its full-screen timer with no tab bar (already the case: `App` returns `TimerScreen` alone).
- Assumptions: the "save current settings" form stays on the Timer tab next to the settings it saves; the Saved tab lists, loads and deletes. Settings and Privacy open from Profile and go back to Profile. History has no back button, since it is a tab.

## Tasks

- [x] T1 (S1, S2, S4) Tab bar, Profile screen, navigation in App, History as a tab, Settings and Privacy under Profile; save form on Timer, list on Saved. Route: inline. Risk: none (UI only; deletion logic untouched, only where its control is shown). Commit: 13cdb6f.
- [x] T2 (S3) Mode chips with the selected description, selected chip kept in view. Route: inline. Commit: 13cdb6f.
- [x] T3 (S1-S3) End-to-end suites (Chrome and emulator) follow the new navigation. Route: inline. Commit: see L3.

## Log

- L1 (2026-11-12): "aun no, quisiera hacer un cambio para que se vea todo mejor ordenado, hoy esta todo en una pagina de inicio todo mezlado, me gustaria ordenar algunos elementos ya que en un celular se queda todo mas apretado, por ejemplo pordriamos poner en la misma seccion donde esta el idioma poner el perfil de usuario y mediante un click n el perfil aparezcan las opciones de configuracion, provacidad, eliminar cuenta, historial, etc, que otra opcion podriamos hacer el ordenamientos?"
- L2 (2026-11-12): Proposed an avatar menu (recommended) or a bottom tab bar. User: "la contra que dices no deberia de molestar ya que la visual del usuario deberia de mostrar el entrenamiento en proceso como ya esta hecho" (verified: `App` returns `TimerScreen` alone while a workout runs). Then "si" to the tab bar.
- L3 (2026-11-12): T1-T3 done on feat/tab-navigation. RED observed: 6 App tests for tabs, Profile, Settings/Privacy under Profile, save on Timer and load from Saved, chips. 24 existing unit tests and 4 e2e steps only changed how they navigate. A resumed deletion now opens Profile (`onResume`), where its progress and errors show. Phone screenshots (390x844) found the selected chip scrolled out of view; fixed by scrolling the row to it. Checks: unit 297 of 297, typecheck 0, lint 0, Chrome e2e 17 of 17, emulator e2e 27 of 27. Local preview of the e2e build at http://localhost:4173 for the user. Not merged, pushed or deployed.
