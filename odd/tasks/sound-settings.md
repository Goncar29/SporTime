Objective: a settings section with sound settings, including voice announcements from the system voice.
Branch: feat/sound-settings, from main at 09d092f. Delivery strategy: ask-on-risk. Test runner: `pnpm test` (Node 24).
The push and deploy of main (sportime-v1 T5) wait until this feature is done, by the user's choice.

## Specs

- S1. Request: "deberiamos de tener una seccion de configuracion y dentro un "ajuste de sonidos" con opciones de avisos por voz, 3-2-1, quedan 10 seg, mitad, nombre de intervalo, sonido de intervalo, etc"
- S2. Voice source: "vamos con la voz del sistema" (`speechSynthesis`). When no voice is available the tones remain, so the timer is never silent.
- S3. Proposed and not objected to: a Settings link on the main screen; one switch per option: voice announcements (master), 3-2-1 countdown, 10 seconds left (only in intervals longer than that), halfway, interval name, interval sound.
- S4. Proposed and not objected to: interval names are the existing kinds (prepare, work, rest, set rest); custom names are another feature. The voice follows the app's language. Settings are kept per device, which works offline and leaves the Firestore rules untouched.

## Tasks

- [ ] T1 (S1-S4) Sound settings, announcements, settings screen, privacy notice. Route: inline, no writer trigger. Code done; waits on the user hearing the real voice.

## Log

- L1 (2026-11-05): "antes me ustaria hacer una feature nueva, sobre el sonido, deberiamos de tener una seccion de configuracion y dentro un "ajuste de sonidos" con opciones de avisos por voz, 3-2-1, quedan 10 seg, mitad, nombre de intervalo, sonido de intervalo, etc"
- L2 (2026-11-05): "vamos con la voz del sistema"
- L3 (2026-11-05): T1 code complete. Assumptions, not requested: the voice starts off, so a default install sounds exactly as before; 3-2-1 is a tone with the voice off and spoken with it on; turning off interval sound leaves its vibration, while turning off 3-2-1 removes its vibration too; the 10 seconds and halfway warnings skip the prepare phase; when they share a moment (a 20-second interval) only "10 seconds left" is said, unless it is switched off; the finish is spoken under interval name. A language with no voice on the device, or a real speech error, falls back to tones. RED observed: 6 test files failed before the code. Checks by exit code: 229 unit, 17 Chrome end-to-end, 26 emulator, rules, build, `vp check` after its formatter. Chrome end-to-end tests use a recorded fake voice, so the real voice is unexercised, including `cancel` followed by `speak` on phones and whether a voice works offline. Risk: none.
- L4 (2026-11-05): "las decisiones que tomaste estan correctas pero ya probe activando la voz pero parece que esta como antes, no se escucha nada de lo nuevo, esto lo tuviste en cuenta para los dos idiomas o solo para uno?" Decisions in L3 confirmed. Both languages are implemented. Probe on this machine with fresh profiles: Chrome and Brave report 0 voices from `getVoices`, with or without `--enable-speech-dispatcher`, so `canSpeak` is false and the app plays tones. Brave without the flag also fails with `synthesis-failed`. Chrome reports `start` and `end` with 0 voices, which proves no audio, so an empty voice list keeps falling back to tones. Brave is running here and its Shields fit the earlier `ERR_BLOCKED_BY_CLIENT`, but the user's own profile was not read. Added a visible warning on the settings screen, since the switch looked as if it did nothing. RED observed: 1 test. The real voice is still unheard.
