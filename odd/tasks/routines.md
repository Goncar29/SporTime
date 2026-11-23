Objective: users keep training routines split into stages in a new Profile section, and share them with saved contacts (phases 2-4).
Branch: feat/routines, from main. Delivery strategy: work-unit commits on the branch; rules publish, push, merge and deploy only with the user's OK (rules before the app). Test runner: `npx pnpm@10 exec vp test run`; rules with `test:rules` on the emulator; emulator end-to-end suite.

## Specs

- S1. Routine content: "una seccion donde un usuario pueda cargar sus rutinas de entrenamientos dividia en pequeñas secciones por etapas con posible espacio de comentarios aparte si es deseado, donde se pueda poner en cada etapa el nombre de entrenamiento, repeticiones por (ejemplo 8 - 10), pausas en tiempo (ejemplo 90') y el peso".
- S2. Lifecycle and place: "estas rutinas se puedan crear, editar, eliminar y compartir con otros usuarios en una seccion nueva dentro del perfil".
- S3. Optional fields: "los valores a agruegar en esas secciones de ejercicios son opcionales, sin obligacion que se deba de llenar todos los campos". Accepted limits ("acepto los limites que dices"): the routine needs a name; an exercise with no field filled is discarded on save; a stage without a name shows as "Etapa 1", "Etapa 2"…
- S4. Field shapes (accepted plan): reps empty, one value ("10") or a range ("8 - 10") stored as `repsMin`/`repsMax`; rest stored as `restSeconds` and shown like 90''; weight is a number plus unit, "Número + unidad (kg/lb)", unit required only when a weight is present (default kg).
- S5. Storage: Firestore, no new technology ("Sin servidor por ahora"). Works offline through the existing outbox; no routine is lost when a write fails or the device is offline. Security rules validate every field; text is rendered as text only (never as HTML).
- S6. Account: deleting the account and signing out erase routines like workouts and history.
- S7. Sharing (phases 2-4): "la manera de compartir podria ser agregar el email del usuario a una lista, cuando un usuario quiera compartir esa rutina se pueda seleccionar y elegir el/los email guardados y que muestre en esa lista la foto de la persona y seleccionarlos, al agregar se pueda confirmar el envio y que estos usuario los reciban en su perfil recibiendolo con una notificacion y se guarden en su perfil." Decisions: received routines "Se guarda automáticamente"; senders: "Solo quien me tiene en contactos"; in-app notification only; block sender.

## Tasks

- [x] T1 (S1, S3, S4) Routine domain: model, limits, normalize/parse, display helpers. Route: inline. Commit: this commit (feat(routines): add routine domain).
- [ ] T2 (S5) Rules for `users/{uid}/routines`, including a maximum-size routine within Firestore's rule evaluation limits; rules tests. Route: inline. Risk: item 2 (security rules).
- [ ] T3 (S2, S5) Firestore routine library with outbox + fake. Route: inline. Risk: item 1 (stored data).
- [ ] T4 (S2, S6) Account deletion and sign-out include routines. Route: inline. Risk: item 1.
- [ ] T5 (S1-S4) Profile section UI: list, create, edit, delete; i18n en/es. Route: inline.
- [ ] T6 (S2, S5) Emulator end-to-end: create, edit, delete reach the server. Route: inline.
- [ ] T7 (S7) Phase 2: contacts and email directory. Not started.
- [ ] T8 (S7) Phase 3: share. Not started.
- [ ] T9 (S7) Phase 4: receive, notification, block. Not started.

## Log

- L1: "me gustaria hacer una feature nueva, pero creo que implicaria varios cambios, quisiera ver antes de escribir cualquier codigo planificar como lo podriamos hacer, mi idea en la feature nueva es una seccion donde un usuario pueda cargar sus rutinas de entrenamientos dividia en pequeñas secciones por etapas con posible espacio de comentarios aparte si es deseado, donde se pueda poner en cada etapa el nombre de entrenamiento, repeticiones por (ejemplo 8 - 10), pausas en tiempo (ejemplo 90') y el peso, estas rutinas se puedan crear, editar, eliminar y compartir con otros usuarios en una seccion nueva dentro del perfil, la manera de compartir podria ser agregar el email del usuario a una lista, cuando un usuario quiera compartir esa rutina se pueda seleccionar y elegir el/los email guardados y que muestre en esa lista la foto de la persona y seleccionarlos, al agregar se pueda confirmar el envio y que estos usuario los reciban en su perfil recibiendolo con una notificacion y se guarden en su perfil. Tenemos que ver como planificar esto, que cambiar, riesgos, es mejor unas base de datos o no en caso de si que tipo, la perdida de datos en caso de que el envio falle o que el que recibe no tenga conexion y falle u otro problema, evitar el promp injection y diferentes problemas de seguridad, etc"
- L2: Decisions: "Sin servidor por ahora"; "Se guarda automáticamente"; "Solo quien me tiene en contactos"; "Número + unidad (kg/lb)".
- L3: "ten en cuenta que los valores a agruegar en esas secciones de ejercicios son opcionales, sin obligacion que se deba de llenar todos los campos"
- L4: "acepto los limites que dices, crees que no es necesario agruegar ningun tipo de tecnologia o cambios? con lo que tenemos armado es posible=" — answered: possible with the current stack; rule evaluation limit to be checked first.
- L5: "ok" — start phase 1 on a new branch.
