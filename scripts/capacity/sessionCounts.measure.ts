/**
 * T32: counts the Firestore reads, writes and deletes of a typical SporTime session on the local
 * emulator, per action, using the app's own Firestore adapters (src/<feature>/infrastructure) with
 * the same queries, outboxes and receiver the signed-in app mounts (src/main.tsx, src/app/App.tsx).
 * Each "client" is one Firebase app in Node with Firestore's memory cache, so every open is cold
 * (no IndexedDB cache to resume from). See scripts/capacity/README.md for the method, its limits
 * and the command; never point it at production (it only connects to 127.0.0.1:8080).
 */
import { writeFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  terminate,
  type Firestore,
} from "firebase/firestore";
import { afterAll, expect, it } from "vite-plus/test";
import { createFirestoreContactStore } from "../../src/contacts/infrastructure/firestoreContactStore";
import type { Contact } from "../../src/contacts/domain/contact";
import { createFirestoreDirectoryListing } from "../../src/directory/infrastructure/firestoreDirectoryListing";
import { createFirestoreHistoryLog } from "../../src/history/infrastructure/firestoreHistoryLog";
import type { HistoryDraft } from "../../src/history/domain/historyEntry";
import { createFirestoreRoutineLibrary } from "../../src/routines/infrastructure/firestoreRoutineLibrary";
import type { Routine, RoutineDraft } from "../../src/routines/domain/routine";
import type { OutboxStore, Pending } from "../../src/shared/application/outbox";
import { createInboxReceiver } from "../../src/sharing/application/receiveInbox";
import { createRoutineSharing } from "../../src/sharing/application/shareRoutine";
import type { BlockedSender } from "../../src/sharing/domain/blockedSender";
import { createFirestoreBlockedSenders } from "../../src/sharing/infrastructure/firestoreBlockedSenders";
import { createFirestoreInbox } from "../../src/sharing/infrastructure/firestoreInbox";
import { createFirestoreInboxReader } from "../../src/sharing/infrastructure/firestoreInboxReader";
import type { SavedWorkout, SavedWorkoutDraft } from "../../src/workouts/domain/savedWorkout";
import { defaultConfig } from "../../src/workouts/domain/workout";
import { createFirestoreWorkoutLibrary } from "../../src/workouts/infrastructure/firestoreWorkoutLibrary";
import { startWireCounter, type PhaseResult, type Tally } from "./wireCounter";

const PROJECT = "demo-sportime";
const HOST = "127.0.0.1";
const PORT = 8080;

/** Realistic sizes for one active user (T32). */
const SIZES = {
  workouts: 30,
  routines: 10,
  history: 50,
  contacts: 10,
  blocked: 2,
  inbox: 3,
};

// --- users ---------------------------------------------------------------------------------

const run = Date.now().toString(36);

interface User {
  uid: string;
  email: string;
  name: string;
}

const roles = new Map<string, string>();
function user(role: string, index?: number): User {
  const key = index === undefined ? role : `${role}${index}`;
  const uid = `cap-${run}-${key}`;
  roles.set(uid, role);
  return { uid, email: `${key}-${run}@example.com`, name: `Capacity ${key}` };
}

const me = user("me");
const empty = user("empty");
const contacts = Array.from({ length: SIZES.contacts }, (_, i) =>
  user(i === 0 ? "friend" : "contact", i),
);
const friend = contacts[0] as User;
const newContact = user("newContact");
const senders = Array.from({ length: SIZES.inbox }, (_, i) => user("sender", i));
const blockedUsers = Array.from({ length: SIZES.blocked }, (_, i) => user("blocked", i));

// --- clients -------------------------------------------------------------------------------

let clientCount = 0;
const openClients = new Set<() => Promise<void>>();

/** One signed-in device: its own Firebase app and Firestore, memory cache, emulator only. */
function client(account: User): { db: Firestore; close: () => Promise<void> } {
  const app = initializeApp(
    { projectId: PROJECT, apiKey: "demo-key" },
    `capacity-${clientCount++}`,
  );
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, HOST, PORT, {
    mockUserToken: {
      sub: account.uid,
      email: account.email,
      email_verified: true,
      name: account.name,
      firebase: { sign_in_provider: "google.com", identities: {} },
    },
  });
  const close = async () => {
    openClients.delete(close);
    await terminate(db);
    await deleteApp(app);
  };
  openClients.add(close);
  return { db, close };
}

function memoryStore<Draft>(): OutboxStore<Draft> {
  let items: Pending<Draft>[] = [];
  return {
    load: () => items,
    save(next) {
      items = next;
    },
  };
}

const ready = () => Promise.resolve(true);

/** The stores main.tsx builds for one account (without the other-tabs guard, which reads nothing). */
function storesFor(db: Firestore, account: User) {
  const routines = createFirestoreRoutineLibrary(db, account.uid, {
    store: memoryStore<RoutineDraft>(),
    whenReady: ready,
  });
  const blocked = createFirestoreBlockedSenders(db, account.uid, {
    store: memoryStore<BlockedSender>(),
    whenReady: ready,
  });
  return {
    workouts: createFirestoreWorkoutLibrary(db, account.uid, {
      store: memoryStore<SavedWorkoutDraft>(),
      whenReady: ready,
    }),
    history: createFirestoreHistoryLog(db, account.uid, {
      store: memoryStore<HistoryDraft>(),
      whenReady: ready,
    }),
    routines,
    contacts: createFirestoreContactStore(db, account.uid, {
      store: memoryStore<Contact>(),
      whenReady: ready,
    }),
    blocked,
    directory: createFirestoreDirectoryListing(db, { id: account.uid, ...account, photoUrl: null }),
    receiving: createInboxReceiver({
      inbox: createFirestoreInboxReader(db, account.uid),
      routines,
      blocked,
    }),
    sharing: createRoutineSharing({
      identity: {
        claims: () =>
          Promise.resolve({
            uid: account.uid,
            email: account.email,
            emailVerified: true,
            name: account.name,
          }),
      },
      inbox: createFirestoreInbox(db),
      online: () => true,
    }),
  };
}

type Stores = ReturnType<typeof storesFor>;

const failures: string[] = [];
const fail = (what: string) => (error: unknown) => {
  failures.push(`${what}: ${String(error)}`);
};

/**
 * What App mounts once signed in, on the timer screen: the workout, routine, contact and blocked
 * lists (useLiveList) and the inbox receiver (which listens to the inbox and, through
 * subscribeAnswered, twice more to the blocked list). History and the directory switch are only
 * mounted on their screens.
 */
function openApp(stores: Stores) {
  const latest: {
    workouts: SavedWorkout[] | null;
    routines: Routine[] | null;
    contacts: Contact[] | null;
    blocked: BlockedSender[] | null;
  } = { workouts: null, routines: null, contacts: null, blocked: null };
  const stops = [
    stores.workouts.subscribe((items) => {
      latest.workouts = items;
    }, fail("workouts")),
    stores.routines.subscribe((items) => {
      latest.routines = items;
    }, fail("routines")),
    stores.contacts.subscribe((items) => {
      latest.contacts = items;
    }, fail("contacts")),
    stores.blocked.subscribe((items) => {
      latest.blocked = items;
    }, fail("blocked")),
    stores.receiving.start(),
  ];
  return {
    latest,
    close() {
      for (const stop of stops) stop();
    },
  };
}

async function until(check: () => boolean, what: string, ms = 30_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// --- data ----------------------------------------------------------------------------------

const routineDraft = (index: number): RoutineDraft => ({
  name: `Routine ${index + 1}`,
  notes: "Two sessions a week",
  createdAt: index + 1,
  stages: ["Warm-up", "Strength", "Finisher"].map((name) => ({
    name,
    exercises: ["Squat", "Bench press", "Row", "Deadlift", "Plank"].map((exercise) => ({
      name: exercise,
      repsMin: 8,
      repsMax: 10,
      restSeconds: 90,
      weight: 60,
      weightUnit: "kg" as const,
    })),
  })),
});

const workoutDraft = (index: number): SavedWorkoutDraft => ({
  name: `Workout ${index + 1}`,
  config: defaultConfig("tabata"),
  createdAt: index + 1,
});

const historyDraft = (index: number): HistoryDraft => ({
  config: defaultConfig("tabata"),
  finishedAt: index + 1,
  activeMs: 240_000,
  marks: 0,
});

async function withClient<T>(account: User, work: (stores: Stores) => Promise<T>): Promise<T> {
  const { db, close } = client(account);
  try {
    return await work(storesFor(db, account));
  } finally {
    await close();
  }
}

async function shareTo(stores: Stores, routine: Routine, contact: Contact) {
  const prepared = await stores.sharing.prepare(routine, [contact]);
  if (prepared.kind !== "ready") throw new Error(`Share not ready: ${prepared.kind}`);
  const deliveries = await prepared.share.send();
  if (deliveries.some(({ outcome }) => outcome !== "sent")) {
    throw new Error(`Share not sent: ${JSON.stringify(deliveries.map(({ outcome }) => outcome))}`);
  }
}

/** Everything the measured session starts from; nothing here is counted. */
async function seed() {
  // Who may be added or shared to has opted in to the directory.
  for (const account of [me, ...contacts, newContact]) {
    await withClient(account, (stores) => stores.directory.list());
  }
  await withClient(me, async (stores) => {
    for (let i = 0; i < SIZES.workouts; i += 1) await stores.workouts.save(workoutDraft(i));
    for (let i = 0; i < SIZES.routines; i += 1) await stores.routines.save(routineDraft(i));
    for (let i = 0; i < SIZES.history; i += 1) await stores.history.add(historyDraft(i));
    for (const contact of contacts) await (await stores.contacts.add(contact.email)).saved;
    for (const blocked of blockedUsers) {
      await stores.blocked.block({ uid: blocked.uid, name: blocked.name, email: blocked.email });
    }
  });
  // Three contacts of mine each sent me a routine while I was away.
  for (const sender of senders) {
    await withClient(sender, async (stores) => {
      const { contact, saved } = await stores.contacts.add(me.email);
      await saved;
      await stores.routines.save(routineDraft(0));
      const open = openApp(stores);
      await until(() => open.latest.routines?.length === 1, "the sender's routine");
      const routine = open.latest.routines?.[0] as Routine;
      open.close();
      await shareTo(stores, routine, contact);
    });
  }
}

// --- report --------------------------------------------------------------------------------

const results: PhaseResult[] = [];

const cells = (tally: Tally) =>
  `${tally.reads} | ${tally.emptyQueryReads} | ${tally.ruleReads} | ${tally.writes} | ${tally.deletes} | ${tally.emulatorResends}`;

function report(): string {
  const lines = [
    `T32 capacity counts, emulator run ${run} (${new Date().toISOString()})`,
    `Sizes for "me": ${JSON.stringify(SIZES)}`,
    "",
    "| Action | Where | Reads (wire) | Empty-query reads (billing min.) | Rule reads (derived) | Writes | Deletes | Emulator resends (not billed) |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const phase of results) {
    lines.push(`| **${phase.name}** | **total** | ${cells(phase.total)} |`);
    for (const [place, tally] of [...phase.byPlace].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`|  | ${place} | ${cells(tally)} |`);
    }
  }
  lines.push("", "Listener targets opened per action (one per distinct query or document):");
  for (const phase of results) {
    const opened = [...phase.targetsOpened].map(([place, count]) => `${place} x${count}`);
    lines.push(`- ${phase.name}: ${opened.length === 0 ? "none" : opened.join(", ")}`);
  }
  if (failures.length > 0) lines.push("", "Failures reported by the stores:", ...failures);
  return lines.join("\n");
}

// --- the session ---------------------------------------------------------------------------

const quiet = console.log;

afterAll(async () => {
  // Each close removes itself from the set, which for...of over a Set allows.
  for (const close of openClients) await close();
  console.log = quiet;
});

it("counts the Firestore operations of a typical session", { timeout: 600_000 }, async () => {
  // The SDK's debug log, which the counter reads, would otherwise flood the output.
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("@firebase/firestore")) return;
    quiet(...args);
  };
  const counter = startWireCounter((uid) => roles.get(uid) ?? "other");
  await seed();
  await counter.settle();

  const phase = async (name: string, action: () => Promise<void>) => {
    counter.begin(name);
    await action();
    await counter.settle();
    results.push(counter.end());
  };

  // 1. Opening the app signed in, with realistic data and three copies waiting in the inbox.
  const device = client(me);
  const stores = storesFor(device.db, me);
  const app = openApp(stores);
  await phase("Open app (realistic data, 3 inbox copies received)", async () => {
    await until(
      () =>
        app.latest.workouts?.length === SIZES.workouts &&
        app.latest.routines?.length === SIZES.routines + SIZES.inbox &&
        app.latest.contacts?.length === SIZES.contacts &&
        app.latest.blocked?.length === SIZES.blocked,
      "the realistic lists",
    );
  });

  // 2. The same account on a second, cold client (another device, or a tab with no shared cache).
  const second = client(me);
  const secondApp = openApp(storesFor(second.db, me));
  await phase("Open app again on a second cold client (same data, inbox now empty)", async () => {
    await until(
      () =>
        secondApp.latest.workouts?.length === SIZES.workouts &&
        secondApp.latest.routines?.length === SIZES.routines + SIZES.inbox,
      "the second client's lists",
    );
  });
  secondApp.close();
  await second.close();

  // 3. An account with no data at all.
  const emptyDevice = client(empty);
  const emptyApp = openApp(storesFor(emptyDevice.db, empty));
  await phase("Open app (no data)", async () => {
    await until(
      () =>
        emptyApp.latest.workouts !== null &&
        emptyApp.latest.routines !== null &&
        emptyApp.latest.contacts !== null &&
        emptyApp.latest.blocked !== null,
      "the empty lists",
    );
  });
  emptyApp.close();
  await emptyDevice.close();

  // 4. Screens that add a listener while shown.
  let historySize = -1;
  let stopHistory = () => undefined as void;
  await phase(`Open History screen (${SIZES.history} entries, limit 100)`, async () => {
    stopHistory = stores.history.subscribe((items) => {
      historySize = items.length;
    }, fail("history"));
    await until(() => historySize === SIZES.history, "the history");
  });
  stopHistory();
  let listed: boolean | null = null;
  let stopDirectory = () => undefined as void;
  await phase("Open Profile or Contacts (find-by-email switch)", async () => {
    stopDirectory = stores.directory.subscribe((value) => {
      listed = value;
    }, fail("directory"));
    await until(() => listed !== null, "the directory switch");
  });
  stopDirectory();

  // 5. Actions, with the app's lists still open as on the device.
  await phase("Save a workout", () => stores.workouts.save(workoutDraft(SIZES.workouts)));
  await phase("Finish a session (history entry)", () =>
    stores.history.add(historyDraft(SIZES.history)),
  );
  const own = app.latest.routines?.find((routine) => routine.receivedFrom === undefined) as Routine;
  await phase("Edit a routine", () =>
    stores.routines.update({ ...own, name: `${own.name} (edited)` }),
  );
  await phase("Delete an own routine", () => stores.routines.remove(own.id));
  const received = app.latest.routines?.find(
    (routine) => routine.receivedFrom !== undefined,
  ) as Routine;
  await phase("Delete a received routine (batch with its inbox copy)", () =>
    stores.routines.remove(received.id),
  );
  await phase("Add a contact (directory lookup + contact write)", async () => {
    await (
      await stores.contacts.add(newContact.email)
    ).saved;
  });

  // 6. Sharing with the recipient's app open, then with two of their clients open.
  const friendDevice = client(friend);
  const friendStores = storesFor(friendDevice.db, friend);
  const friendApp = openApp(friendStores);
  await until(() => friendApp.latest.routines !== null, "the friend's app");
  await counter.settle();
  const friendContact = app.latest.contacts?.find(({ uid }) => uid === friend.uid) as Contact;
  const shared = app.latest.routines?.find(
    (routine) => routine.receivedFrom === undefined,
  ) as Routine;
  await phase(
    "Share a routine to one contact, recipient's app open (send + live receive)",
    async () => {
      await shareTo(stores, shared, friendContact);
      await until(() => friendApp.latest.routines?.length === 1, "the friend's received routine");
    },
  );
  const friendTab = client(friend);
  const friendTabApp = openApp(storesFor(friendTab.db, friend));
  await until(() => friendTabApp.latest.routines?.length === 1, "the friend's second client");
  await counter.settle();
  await phase("Share again, recipient has two clients open (both receivers run)", async () => {
    await shareTo(stores, shared, friendContact);
    await until(() => friendApp.latest.routines?.length === 2, "the second received routine");
    await until(() => friendTabApp.latest.routines?.length === 2, "the second client's copy");
  });
  friendTabApp.close();
  await friendTab.close();
  friendApp.close();
  await friendDevice.close();

  // 7. Blocking the sender of a received routine.
  const sender = senders[1] as User;
  await phase("Block a sender", () =>
    stores.blocked.block({ uid: sender.uid, name: sender.name, email: sender.email }),
  );
  await until(() => app.latest.blocked?.length === SIZES.blocked + 1, "the new block");

  app.close();
  await device.close();
  counter.stop();

  const text = report();
  quiet(text);
  if (process.env.CAPACITY_OUT) writeFileSync(process.env.CAPACITY_OUT, `${text}\n`);
  if (process.env.CAPACITY_RAW)
    writeFileSync(process.env.CAPACITY_RAW, counter.rawLines.join("\n"));
  expect(failures).toEqual([]);
});
