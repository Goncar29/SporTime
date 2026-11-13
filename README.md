# Sportime

A workout timer for the gym that you can install on your phone. It runs stopwatch, For Time, AMRAP, EMOM, Tabata and interval workouts, keeps timing with no network, and saves your workouts and history to your Google account.

**Live app:** [sportime-4dc6e.web.app](https://sportime-4dc6e.web.app)

## What it does

| Area               | Details                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Timers**         | Stopwatch, For Time, AMRAP, EMOM, Tabata and intervals, each with a get-ready countdown, rounds and named intervals.                                                                       |
| **Cues**           | Tones, vibration and optional spoken announcements: countdown, 10 seconds left, halfway and the interval's name, each switchable in Settings. The screen stays awake while a workout runs. |
| **Saved workouts** | Save the settings on screen under a name, load them later, edit or delete them.                                                                                                            |
| **History**        | Every finished workout is recorded. You can review and delete entries.                                                                                                                     |
| **Account**        | Sign in with Google: only your name, email and profile photo are used. You can delete your account and all its data from Profile.                                                          |
| **Offline**        | After the first visit, the app loads and times workouts with no connection. Saves made offline are queued and sent when the connection returns.                                            |
| **Installable**    | It is a PWA: the app offers installing on Android and shows the steps on iPhone. New versions apply on their own, but never in the middle of a workout.                                    |
| **Languages**      | English and Spanish, following the browser's language, with a switch in Profile.                                                                                                           |

## How it is built

- **React 19 + TypeScript** for the interface, styled with CSS modules and the Barlow Condensed typeface.
- **[Vite+](https://viteplus.dev)** (`vp`) as the toolchain: dev server, build, tests, lint and formatting.
- **Firebase**: Google sign-in with Authentication, data in Cloud Firestore (with its offline cache), and the site served by Firebase Hosting.
- **vite-plugin-pwa / Workbox** for the service worker that precaches the app and handles updates.

### Architecture

The code follows a **hexagonal architecture** (ports and adapters), organised by feature so the folder names say what the app does:

```
src/
├── timer/      Workout modes, timelines, cues and the running timer
├── workouts/   Saved workouts
├── history/    Finished workout log
├── auth/       Google sign-in and the cached session
├── account/    Profile, privacy and account deletion
├── settings/   Sound and voice settings
├── install/    The install prompt
├── update/     Applying new versions of the app
├── i18n/       English and Spanish copy
├── shared/     Firebase set-up, the offline outbox, store failures
└── app/        The screens, tab bar and wiring
```

Each feature is split in the same layers:

- **`domain/`**: pure rules with no framework or browser code, such as how a Tabata timeline is built.
- **`application/`**: use cases and the **ports** (interfaces) they need, such as `WorkoutLibrary` or `HistoryLog`.
- **`infrastructure/`**: **adapters** that implement those ports with Firestore, `localStorage`, Web Audio, speech synthesis or the Wake Lock API, plus in-memory fakes for tests.
- **`ui/`**: React components and hooks.

`src/main.tsx` is the only place that chooses the adapters. Development and end-to-end builds swap in fakes or the Firebase emulators at build time, so none of that code ships in production.

Firestore security rules live in `firestore/firestore.rules`. Each user can only read and write their own workouts and history, and every document's shape is validated.

## Getting started

You need [Node.js 24](https://nodejs.org) (see `.nvmrc`) and the [Vite+ CLI](https://viteplus.dev/guide/).

```bash
vp install   # install dependencies
vp dev       # start the dev server
```

## Scripts

| Command                | What it does                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| `vp dev`               | Starts the dev server.                                                 |
| `vp run build`         | Type checks and builds for production into `dist/`.                    |
| `vp check`             | Formats, lints and type checks.                                        |
| `vp test`              | Runs the unit and component tests (Vitest + Testing Library).          |
| `vp run test:rules`    | Tests the Firestore rules against the emulator.                        |
| `vp run test:e2e`      | End-to-end tests in Chrome with fake sign-in and storage (Playwright). |
| `vp run test:emulator` | End-to-end tests against the Firebase Auth and Firestore emulators.    |

The emulator scripts need the Firebase CLI's emulators, which require Java.

## Deploying

```bash
vp run build
pnpm exec firebase deploy --only firestore:rules   # rules first, when they change
pnpm exec firebase deploy --only hosting
```
