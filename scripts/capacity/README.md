# Capacity counts (T32)

Counts the Firestore document reads, writes and deletes of a typical SporTime session, per
action, on the **local emulator only** (127.0.0.1:8080, project `demo-sportime`; never
production).

## Run

From the repository root, in Git Bash (Java 21 for the emulator):

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.13.9-hotspot" PATH="$JAVA_HOME/bin:$PATH" APPDATA='C:\Users\carlo\AppData\Roaming' JAVA_TOOL_OPTIONS=-Xmx384m
CAPACITY_OUT="$(mktemp -d)/counts.md" npx pnpm@10 exec firebase emulators:exec --only firestore --project demo-sportime "vp test run --config scripts/capacity/vitest.config.ts"
```

The table is written to `CAPACITY_OUT` (outside the repository). `CAPACITY_RAW=<file>` also
saves the SDK's raw gRPC log that the counts come from. Each run uses fresh uids
(`cap-<run>-...`), so it can also run against an emulator that is already up.

## Method

`sessionCounts.measure.ts` builds the app's own Firestore adapters (workouts, routines, history,
contacts, blocked senders, directory, inbox reader and writer, receiver, sharing) the way
`src/main.tsx` wires them, seeds realistic data through them (30 workouts, 10 routines, 50
history entries, 10 contacts, 2 blocked senders, 3 routines waiting in the inbox), then mounts
what `App` mounts when signed in and runs each action. `wireCounter.ts` turns on the Firebase
SDK's debug log and counts the gRPC messages it shows: documents a listener receives, transaction
reads, writes and deletes. Rule `get`/`exists` reads are not on the wire: they are added per
accepted write from `firestore/firestore.rules` (contact create 1, inbox copy create 3).

## Limits

- Node clients use Firestore's memory cache: every open is cold. The browser app uses the
  persistent multi-tab cache, so a reopen within 30 minutes resumes its listeners and is billed
  only for changed documents; a reopen after 30 minutes is billed like these cold opens.
- A second browser tab shares the first tab's listeners through IndexedDB (multi-tab manager),
  so it adds no listener reads; the "second cold client" row is a second device (or a browser
  without the shared cache). Its receiver still runs, as the "two clients" share row shows.
- The emulator answers every change to a listened query by resending all its documents (a
  RESET); those are counted apart as "emulator resends" and are not production reads.
- Empty-query reads (Firestore bills one read for a query or document target that returns
  nothing) are inferred from targets that become current with no document.
- No billing data exists on the emulator: the counts are wire messages mapped to Firestore's
  published billing rules.
- React StrictMode's double effects (development only) and the other-tabs guard (no reads) are
  not reproduced.
