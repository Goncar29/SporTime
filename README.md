# Sportime

<p align="center">
  <img src="public/icon-192.png" alt="The Sportime logo, an S inside a stopwatch" width="128" height="128" />
</p>

A workout timer for the gym that you can install on your phone. It runs stopwatch, For Time, AMRAP, EMOM, Tabata and interval workouts, keeps timing with no network, and saves your workouts and history to your Google account.

**Live app:** [sportime-4dc6e.web.app](https://sportime-4dc6e.web.app)

## What it does

| Area               | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timers**         | Stopwatch, For Time, AMRAP, EMOM, Tabata and intervals, each with a get-ready countdown, rounds and named intervals.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Cues**           | Tones, vibration and optional spoken announcements: countdown, 10 seconds left, halfway and the interval's name, each switchable in Settings. The screen stays awake while a workout runs.                                                                                                                                                                                                                                                                                                                                                                       |
| **Saved workouts** | Save the settings on screen under a name, load them later, edit or delete them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **History**        | Every finished workout is recorded. You can review and delete entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Account**        | Sign in with Google: only your name, email and profile photo are used. You can delete your account and all its data from Profile.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Contacts**       | Opt in from Profile to be found by your exact email (only your Google name and photo show). Add up to 50 contacts by email, with their photo, and remove them.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Sharing**        | Send a copy of a routine to one or more contacts from its view, after confirming. It needs a connection: a copy is never queued, and each recipient's result is shown. A copy you receive is saved among your routines by itself, marked with the sender's name and email. Received routines you have not seen yet are marked New in the list and counted on Profile, on this device. From a received routine you can block its sender: they can no longer send you routines, and those you received stay; the blocked list, in Contacts, lets you unblock them. |
| **Offline**        | After the first visit, the app loads and times workouts with no connection. Saves made offline are queued and sent when the connection returns.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Installable**    | It is a PWA: the app offers installing on Android and shows the steps on iPhone. New versions apply on their own, but never in the middle of a workout.                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Languages**      | English and Spanish, following the browser's language, with a switch in Profile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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
├── routines/   Training routines split into stages
├── directory/  The opt-in find-by-email directory
├── contacts/   Contacts added by email
├── sharing/    Sending copies of routines to contacts
├── auth/       Google sign-in and the cached session
├── account/    Profile, privacy and account deletion
├── settings/   Sound and voice settings
├── install/    The install prompt
├── update/     Applying new versions of the app
├── i18n/       English and Spanish copy
├── shared/     Firebase set-up, the offline outbox, store failures
└── app/        The screens, tab bar and wiring
```

Each feature uses the layers it needs from these:

- **`domain/`**: pure rules with no framework or browser code, such as how a Tabata timeline is built.
- **`application/`**: use cases and the **ports** (interfaces) they need, such as `WorkoutLibrary` or `HistoryLog`.
- **`infrastructure/`**: **adapters** that implement those ports with Firestore, `localStorage`, Web Audio, speech synthesis or the Wake Lock API, plus in-memory fakes for tests.
- **`ui/`**: React components and hooks.

`src/main.tsx` is the only place that chooses the adapters. Development and end-to-end builds swap in fakes or the Firebase emulators at build time, so none of that code ships in production.

Firestore security rules live in `firestore/firestore.rules`. Each user can only read and write their own workouts, history, routines and contacts, and every document's shape is validated. The one exception is the opt-in directory: a signed-in user can read a single entry (uid, Google name and photo) by its exact email, never list them, and only the owner of that verified email can write or remove it. Contacts keep a copy of that entry; deleting the account removes the user's contacts and their own directory entry. A user may also write a copy of a routine into a contact's inbox (`users/{recipient}/inbox/{copyId}`): only to someone in their contacts, with their Google name, photo and verified email taken from their sign-in, checked more strictly than one's own routines, and never changed once sent. The app checks a copy the same way before sending it, and sends it in a one-attempt transaction, so it is never queued offline nor resent after a lost answer. The recipient's app turns each copy into one of their routines under the copy's id (so receiving it twice writes one routine), keeping the sender's uid, name and email as `receivedFrom` (the uid is the one the inbox rules bound to the copy's writer), which the routine rules check too. It writes the routine only after the server itself says no routine with that id exists (never from this device's cache, and nothing while offline, so an edit made on another device is never overwritten), and deletes the copy only once the server holds the routine. Deleting a received routine also deletes its copy if one is still in the inbox, in the same write, so it does not come back. Deleting the account also erases the inbox. Each user also keeps who they blocked (`users/{uid}/blocked/{sender uid}`: exactly the name and email shown when blocking, owner only, kept through the outbox like contacts); the inbox refuses every copy from a sender the recipient blocked, which the sender sees as an ordinary refusal, and the app deletes, instead of receiving, a copy such a sender left before the block. Deleting the account erases the blocked list too. Which received routines were already seen is kept in this browser only and erased on sign-out.

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

---

<p align="center">
  <img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle AI" />
</p>
