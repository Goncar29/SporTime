import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  Timestamp,
  connectFirestoreEmulator,
  deleteDoc,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getFirestore,
  setDoc,
  terminate,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DIRECTORY_LIMITS } from "../src/directory/domain/directory";
import {
  ROUTINE_LIMITS,
  parseRoutine,
  toStoredRoutine,
  type RoutineDraft,
  type StoredRoutine,
} from "../src/routines/domain/routine";
import { createFirestoreRoutineLibrary } from "../src/routines/infrastructure/firestoreRoutineLibrary";
import type { OutboxStore, Pending } from "../src/shared/application/outbox";
import { MAX_TIMESTAMP_MS } from "../src/shared/domain/timestamp";
import type { InboxCopy } from "../src/sharing/application/ports";
import { createInboxReceiver } from "../src/sharing/application/receiveInbox";
import { receivedRoutine } from "../src/sharing/domain/receivedCopy";
import { buildSharedCopy, type SharedCopy } from "../src/sharing/domain/sharedCopy";
import { createFirestoreInbox } from "../src/sharing/infrastructure/firestoreInbox";
import { createFirestoreInboxReader } from "../src/sharing/infrastructure/firestoreInboxReader";

/**
 * Receiving a shared routine (T26, S12): the sender field on one's own routines
 * (`receivedFrom`, isSender in firestore/firestore.rules), and the whole path through the real
 * rules: a copy sent with the app's adapter, read from the recipient's inbox with the app's
 * reader, turned into a routine by the domain, stored by the routine library and then deleted
 * from the inbox.
 */

let env: RulesTestEnvironment;

const L = ROUTINE_LIMITS;

const aliceToken = {
  email: "Alice@Example.com",
  email_verified: true,
  name: "Alice Liddell",
  picture: "https://lh3.googleusercontent.com/a/alice=s96-c",
};
const bobToken = { email: "bob@example.com", email_verified: true, name: "Bob" };

const asAlice = () =>
  env.authenticatedContext("alice", aliceToken).firestore() as unknown as Firestore;
const asBob = () => env.authenticatedContext("bob", bobToken).firestore() as unknown as Firestore;

const sender = { uid: "alice", name: "Alice Liddell", email: "Alice@Example.com" };
/** The sender as a received routine keeps them, with the Google photo the copy came with (T29 W3). */
const senderWithPhoto = { ...sender, photo: aliceToken.picture };

async function seed(path: string, data: object) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore() as unknown as Firestore, path), data);
  });
}

async function stored(path: string): Promise<Record<string, unknown> | undefined> {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (context) => {
    data = (await getDoc(doc(context.firestore() as unknown as Firestore, path))).data();
  });
  return data;
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

/** Polls until `check` holds, for listeners and writes that settle on their own. */
async function eventually(check: () => Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Every stage, exercise and text at its limit: the most a rule ever has to evaluate. */
function fullRoutine(stages: number = L.stages): RoutineDraft {
  return {
    name: "a".repeat(L.nameLength),
    notes: "n".repeat(L.notesLength),
    createdAt: MAX_TIMESTAMP_MS,
    stages: Array.from({ length: stages }, () => ({
      name: "b".repeat(L.stageNameLength),
      notes: "m".repeat(L.notesLength),
      exercises: Array.from({ length: L.exercisesPerStage }, () => ({
        name: "c".repeat(L.exerciseNameLength),
        repsMin: L.reps.max - 1,
        repsMax: L.reps.max,
        restSeconds: L.restSeconds.max,
        weight: L.weight.max - 0.5,
        weightUnit: "lb" as const,
        notes: "d".repeat(L.exerciseNotesLength),
        link: `https://x.com/${"e".repeat(L.linkLength - 14)}`,
      })),
    })),
  };
}

const PHOTO_BASE = "https://lh3.googleusercontent.com/";

/**
 * The longest sender the app keeps: a 128-character uid, a 100-character name, a 254-character
 * email and a 500-character Google photo (T29 W3).
 */
const longestSender = {
  uid: "u".repeat(L.senderUidLength),
  name: "N".repeat(L.senderNameLength),
  email: `${"e".repeat(L.senderEmailLength - 11)}@example.co`,
  photo: PHOTO_BASE + "p".repeat(DIRECTORY_LIMITS.photoLength - PHOTO_BASE.length),
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-sportime",
    firestore: { rules: readFileSync("firestore/firestore.rules", "utf8") },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed("users/alice/contacts/bob", {
    uid: "bob",
    name: "Bob",
    photo: "",
    email: "bob@example.com",
  });
  // Bob lets people find him by email, so copies may reach him (T29 W1).
  await seed("directory/bob@example.com", { uid: "bob", name: "Bob" });
});

afterAll(async () => {
  await env.cleanup();
});

const routine: StoredRoutine = toStoredRoutine({
  name: "Piernas",
  createdAt: 1_750_000_000_000,
  stages: [{ name: "A", exercises: [{ name: "Sentadilla", repsMin: 8, repsMax: 10 }] }],
  receivedFrom: sender,
});

let nextId = 0;
const freshRoutine = () => doc(asBob(), `users/bob/routines/r${++nextId}`);

describe("the sender of a received routine, on one's own routines (T26, S12)", () => {
  it("is accepted on create, with a name, an empty name, or the longest uid, name and email", async () => {
    expect(routine.receivedFrom).toEqual(sender);
    await assertSucceeds(setDoc(freshRoutine(), routine));
    await assertSucceeds(
      setDoc(freshRoutine(), { ...routine, receivedFrom: { uid: "a", name: "", email: "a@b.co" } }),
    );
    // Firebase uids are letters and digits; any other visible character is allowed but '/'.
    await assertSucceeds(
      setDoc(freshRoutine(), {
        ...routine,
        receivedFrom: { ...sender, uid: "Zx9-_.:é💪 " },
      }),
    );
    await assertSucceeds(setDoc(freshRoutine(), { ...routine, receivedFrom: longestSender }));
    // Self-chosen names may hold bidi controls or emoji: they are shown isolated.
    await assertSucceeds(
      setDoc(freshRoutine(), {
        ...routine,
        receivedFrom: { uid: "a", name: "\u202eecilA 💪", email: "a@b.co" },
      }),
    );
  });

  it("is accepted with the sender's Google photo (T29 W3)", async () => {
    await assertSucceeds(setDoc(freshRoutine(), { ...routine, receivedFrom: senderWithPhoto }));
    await assertSucceeds(
      setDoc(freshRoutine(), {
        ...routine,
        receivedFrom: { ...sender, photo: "https://googleusercontent.com/x" },
      }),
    );
    const ref = freshRoutine();
    await seed(ref.path, routine);
    await assertSucceeds(updateDoc(ref, { receivedFrom: senderWithPhoto }));
  });

  it("is accepted with any email a verified sign-in may hold: '/', spaces, a quoted @ (T29 W4)", async () => {
    for (const email of [
      "a/b@example.com",
      '"al ice"@example.com',
      '"a@b"@example.com',
      "a\u00a0b@example.com",
    ]) {
      await assertSucceeds(
        setDoc(freshRoutine(), { ...routine, receivedFrom: { ...sender, email } }),
      );
    }
  });

  it("is kept on an edit, and may be added or left unchanged by an update", async () => {
    const ref = freshRoutine();
    await seed(ref.path, routine);
    await assertSucceeds(updateDoc(ref, { name: "Mis piernas" }));
    await assertSucceeds(setDoc(ref, { ...routine, name: "Mis piernas" }));
    // A resend of the same document, as the SDK does when an answer was lost.
    await assertSucceeds(setDoc(ref, { ...routine, name: "Mis piernas" }));
    const { receivedFrom: _sender, ...own } = routine;
    const ownRef = freshRoutine();
    await seed(ownRef.path, own);
    await assertSucceeds(updateDoc(ownRef, { receivedFrom: sender }));
  });

  const malformed: [string, unknown][] = [
    ["not a map", "Alice <alice@example.com>"],
    ["a list", ["Alice", "alice@example.com"]],
    ["no uid", { name: "Alice", email: "a@b.co" }],
    ["no name", { uid: "a", email: "a@b.co" }],
    ["no email", { uid: "a", name: "Alice" }],
    ["an extra key", { ...sender, picture: "https://lh3.googleusercontent.com/a" }],
    ["a photo that is not text", { ...sender, photo: 5 }],
    ["a null photo", { ...sender, photo: null }],
    ["an empty photo", { ...sender, photo: "" }],
    ["a photo not on googleusercontent.com", { ...sender, photo: "https://example.com/a.png" }],
    ["a look-alike photo host", { ...sender, photo: "https://googleusercontent.com.evil.co/a" }],
    ["a photo with credentials", { ...sender, photo: "https://a@lh3.googleusercontent.com/a" }],
    ["a photo with a port", { ...sender, photo: "https://lh3.googleusercontent.com:8443/a" }],
    ["an http photo", { ...sender, photo: "http://lh3.googleusercontent.com/a" }],
    ["a space in the photo", { ...sender, photo: "https://lh3.googleusercontent.com/a b" }],
    [
      "a photo of 501 characters",
      {
        ...sender,
        photo: PHOTO_BASE + "p".repeat(DIRECTORY_LIMITS.photoLength - PHOTO_BASE.length + 1),
      },
    ],
    ["a uid that is not text", { ...sender, uid: 5 }],
    ["a null uid", { ...sender, uid: null }],
    ["a list as the uid", { ...sender, uid: ["alice"] }],
    ["a map as the uid", { ...sender, uid: { id: "alice" } }],
    ["an empty uid", { ...sender, uid: "" }],
    ["a uid of 129 characters", { ...sender, uid: "u".repeat(L.senderUidLength + 1) }],
    ["a slash in the uid", { ...sender, uid: "ali/ce" }],
    ["a uid that is a path", { ...sender, uid: "/users/alice" }],
    ["a line break in the uid", { ...sender, uid: "ali\nce" }],
    ["a control character in the uid", { ...sender, uid: "ali\u0007ce" }],
    ["a C1 control in the uid", { ...sender, uid: "ali\u0085ce" }],
    ["a name that is not text", { uid: "a", name: 5, email: "a@b.co" }],
    ["a null name", { uid: "a", name: null, email: "a@b.co" }],
    ["a list as the name", { uid: "a", name: ["Alice"], email: "a@b.co" }],
    [
      "a name of 101 characters",
      { uid: "a", name: "N".repeat(L.senderNameLength + 1), email: "a@b.co" },
    ],
    ["a line break in the name", { uid: "a", name: "Ali\nce", email: "a@b.co" }],
    ["a tab in the name", { uid: "a", name: "Ali\tce", email: "a@b.co" }],
    ["a control character in the name", { uid: "a", name: "Ali\u0007ce", email: "a@b.co" }],
    ["a C1 control in the name", { uid: "a", name: "Ali\u0085ce", email: "a@b.co" }],
    ["an email that is not text", { uid: "a", name: "A", email: 5 }],
    ["an empty email", { uid: "a", name: "A", email: "" }],
    ["an email without @", { uid: "a", name: "A", email: "alice.example.com" }],
    ["an email without a user", { uid: "a", name: "A", email: "@b.co" }],
    ["an email without a domain", { uid: "a", name: "A", email: "a@" }],
    ["a control character in the email", { uid: "a", name: "A", email: "a\u0007@c.co" }],
    ["a C1 control in the email", { uid: "a", name: "A", email: "a\u0085@c.co" }],
    ["a line break in the email", { uid: "a", name: "A", email: "a@c.co\n" }],
    [
      "an email of 255 characters",
      { uid: "a", name: "A", email: `${"e".repeat(L.senderEmailLength - 10)}@example.co` },
    ],
  ];

  it("refuses every malformed sender on create", { timeout: 30_000 }, async () => {
    for (const [label, receivedFrom] of malformed) {
      await assertFails(setDoc(freshRoutine(), { ...routine, receivedFrom })).catch(
        (error: unknown) => {
          throw new Error(`accepted ${label}: ${String(error)}`);
        },
      );
    }
  });

  it("refuses every malformed sender on update", { timeout: 30_000 }, async () => {
    const ref = freshRoutine();
    await seed(ref.path, routine);
    for (const [label, receivedFrom] of malformed) {
      await assertFails(updateDoc(ref, { receivedFrom })).catch((error: unknown) => {
        throw new Error(`accepted ${label}: ${String(error)}`);
      });
    }
    expect(await stored(ref.path)).toEqual(routine);
  });

  it("refuses a null or empty sender on create and update (L64)", async () => {
    for (const receivedFrom of [null, {}]) {
      await assertFails(setDoc(freshRoutine(), { ...routine, receivedFrom }));
      const ref = freshRoutine();
      await seed(ref.path, routine);
      await assertFails(updateDoc(ref, { receivedFrom }));
      expect(await stored(ref.path)).toEqual(routine);
    }
  });

  it("is only the recipient's own: nobody else may write a routine there, sender or not", async () => {
    await assertFails(setDoc(doc(asAlice(), "users/bob/routines/forged"), routine));
  });

  it("fits in the largest routine, with the longest sender, on create, edit and resend", async () => {
    const largest = toStoredRoutine({ ...fullRoutine(), receivedFrom: longestSender });
    expect(largest.stages).toHaveLength(L.stages);
    expect(largest.receivedFrom).toEqual(longestSender);
    expect(longestSender.photo).toHaveLength(DIRECTORY_LIMITS.photoLength);
    const ref = freshRoutine();
    await assertSucceeds(setDoc(ref, largest));
    await assertSucceeds(setDoc(ref, largest));
    await assertSucceeds(setDoc(ref, { ...largest, name: "z".repeat(L.nameLength) }));
    await assertSucceeds(updateDoc(ref, { notes: "o".repeat(L.notesLength) }));
  });
});

/**
 * How many full stages a write may hold before Firestore stops evaluating the rules (1000
 * expressions, L6): measured on a copy of the rules whose stage limit is lifted, so the cost of
 * everything else stays as it is. The limit of 10 must keep at least one stage of headroom.
 */
describe("rule budget with the sender field (T26, L6)", () => {
  const LIFTED = 14;
  let lifted: RulesTestEnvironment;

  const liftedStageRules = () => {
    const rules = readFileSync("firestore/firestore.rules", "utf8");
    const start = rules.indexOf("    function isStages(stages) {");
    const end = rules.indexOf("    }\n", start) + "    }\n".length;
    expect(start).toBeGreaterThan(0);
    const checks = Array.from(
      { length: LIFTED },
      (_, index) => `        && (stages.size() < ${index + 1} || isStage(stages[${index}]))`,
    ).join("\n");
    const body = `    function isStages(stages) {\n      return stages is list\n        && stages.size() <= ${LIFTED}\n${checks};\n    }\n`;
    return rules.slice(0, start) + body + rules.slice(end);
  };

  beforeAll(async () => {
    lifted = await initializeTestEnvironment({
      projectId: "demo-sportime-budget",
      firestore: { rules: liftedStageRules() },
    });
  });

  afterAll(async () => {
    await lifted.cleanup();
  });

  /** The most full stages a create, and an edit of such a routine, are accepted with. */
  async function fullStagesThatFit(receivedFrom?: typeof longestSender) {
    const db = lifted.authenticatedContext("bob").firestore() as unknown as Firestore;
    let create = 0;
    let update = 0;
    for (let stages = 1; stages <= LIFTED; stages++) {
      // Built from one full stage, as the domain keeps at most the limit of 10.
      const base = toStoredRoutine({
        ...fullRoutine(),
        ...(receivedFrom === undefined ? {} : { receivedFrom }),
      });
      const stored = { ...base, stages: Array.from({ length: stages }, () => base.stages[0]!) };
      const ref = doc(db, `users/bob/routines/budget-${receivedFrom ? "s" : "o"}-${stages}`);
      const created = await setDoc(ref, stored).then(
        () => true,
        () => false,
      );
      if (!created) break;
      create = stages;
      const edited = await setDoc(ref, { ...stored, name: "z".repeat(L.nameLength) }).then(
        () => true,
        () => false,
      );
      if (edited) update = stages;
    }
    return { create, update };
  }

  it(
    "keeps a stage of headroom over the limit of 10 with the longest sender",
    { timeout: 30_000 },
    async () => {
      // Measured for T26 with the uid (L62): 12 full stages fit without the sender field and 11
      // with the longest uid, name and email, on create and on edit. The uid first cost the edit
      // its headroom (10), won back by bounding the uid and name lengths in their patterns.
      // T29 adds the longest Google photo to the longest sender.
      const own = await fullStagesThatFit();
      const received = await fullStagesThatFit(longestSender);
      console.warn(
        `Own routine: ${own.create}/${own.update} full stages fit (create/edit); with the longest sender and photo: ${received.create}/${received.update}`,
      );
      expect(own.create).toBeGreaterThan(L.stages);
      expect(own.update).toBeGreaterThan(L.stages);
      expect(received.create).toBeGreaterThan(L.stages);
      expect(received.update).toBeGreaterThan(L.stages);
    },
  );
});

describe("receiving a copy through the real rules (T26, S12)", () => {
  function copyOf(draft: RoutineDraft): SharedCopy {
    const result = buildSharedCopy(draft, {
      uid: "alice",
      email: aliceToken.email,
      emailVerified: true,
      name: aliceToken.name,
      picture: aliceToken.picture,
    });
    if (!("copy" in result)) throw new Error(JSON.stringify(result.problems));
    return result.copy;
  }

  const piernas: RoutineDraft = {
    name: "Piernas",
    notes: "Calentar bien.\nRodillas primero.",
    createdAt: 1,
    stages: [
      {
        name: "Bloque A",
        exercises: [
          {
            name: "Sentadilla",
            repsMin: 8,
            repsMax: 10,
            restSeconds: 90,
            weight: 62.5,
            weightUnit: "kg",
            link: "https://bücher.de/libro",
          },
        ],
      },
      { notes: "Estirar.", exercises: [] },
    ],
  };

  /** What Bob's inbox reader reports first from the server. */
  function firstInboxList(db: Firestore): Promise<InboxCopy[]> {
    return new Promise((resolve, reject) => {
      const stop = createFirestoreInboxReader(db, "bob").subscribe((copies) => {
        setTimeout(stop);
        resolve(copies);
      }, reject);
    });
  }

  it("sent, read by the recipient, mapped by the domain, stored as theirs, then deleted", async () => {
    const copy = copyOf(piernas);
    await assertSucceeds(createFirestoreInbox(asAlice()).create("bob", "copy-1", copy));
    const sentAt = (await stored("users/bob/inbox/copy-1"))?.sentAt as Timestamp;

    const bob = asBob();
    const [item] = await firstInboxList(bob);
    expect(item?.id).toBe("copy-1");
    const received = receivedRoutine(item!.id, item!.data);
    expect(received).not.toBeNull();
    expect(received).toMatchObject({
      id: "copy-1",
      createdAt: sentAt.toMillis(),
      receivedFrom: senderWithPhoto,
    });
    const { id, ...draft } = received!;
    await assertSucceeds(setDoc(doc(bob, "users/bob/routines", id), toStoredRoutine(draft)));
    await assertSucceeds(deleteDoc(doc(bob, "users/bob/inbox", id)));
    expect(await stored("users/bob/inbox/copy-1")).toBeUndefined();
    expect(await stored("users/bob/routines/copy-1")).toEqual({
      name: copy.name,
      notes: copy.notes,
      stages: copy.stages,
      createdAt: sentAt.toMillis(),
      receivedFrom: senderWithPhoto,
    });
  });

  /** A routine library writing into Bob's routines through `db`, as the app builds it. */
  const libraryFor = (db: Firestore) =>
    createFirestoreRoutineLibrary(db, "bob", {
      store: memoryStore(),
      whenReady: () => Promise.resolve(true),
    });

  const sleep = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  /** The routine a received copy becomes, as stored, with the sender kept. */
  const receivedAs = (id: string) => parseRoutine(id, routine)!;

  /** Bob's app: the inbox reader and the routine library, receiving until stopped. */
  function receiveAsBob() {
    const bob = asBob();
    const routines = createFirestoreRoutineLibrary(bob, "bob", {
      store: memoryStore(),
      whenReady: () => Promise.resolve(true),
    });
    return createInboxReceiver({ inbox: createFirestoreInboxReader(bob, "bob"), routines }).start();
  }

  it(
    "is moved into the routines and out of the inbox by the app's receiver",
    { timeout: 30_000 },
    async () => {
      const copy = copyOf(piernas);
      await assertSucceeds(createFirestoreInbox(asAlice()).create("bob", "copy-2", copy));
      const stop = receiveAsBob();
      try {
        await eventually(
          async () => (await stored("users/bob/inbox/copy-2")) === undefined,
          "the copy to leave the inbox",
        );
      } finally {
        stop();
      }
      const routine = await stored("users/bob/routines/copy-2");
      expect(routine).toMatchObject({ name: "Piernas", stages: copy.stages });
      // The sender's Google photo stays with the routine (T29 W3).
      expect(routine?.receivedFrom).toEqual(senderWithPhoto);
    },
  );

  it(
    "receives the largest copy a contact can send, from a sender without a name",
    { timeout: 30_000 },
    async () => {
      const largest = { ...fullRoutine(), createdAt: 1 };
      const result = buildSharedCopy(largest, {
        uid: "alice",
        email: aliceToken.email,
        emailVerified: true,
      });
      if (!("copy" in result)) throw new Error(JSON.stringify(result.problems));
      const alice = env
        .authenticatedContext("alice", { email: aliceToken.email, email_verified: true })
        .firestore() as unknown as Firestore;
      await assertSucceeds(createFirestoreInbox(alice).create("bob", "big", result.copy));
      const stop = receiveAsBob();
      try {
        await eventually(
          async () => (await stored("users/bob/inbox/big")) === undefined,
          "the largest copy to leave the inbox",
        );
      } finally {
        stop();
      }
      expect(await stored("users/bob/routines/big")).toMatchObject({
        stages: result.copy.stages,
        receivedFrom: { uid: "alice", name: "", email: aliceToken.email },
      });
    },
  );

  it(
    "leaves a routine received before, and edited since, as it is when the copy comes again",
    { timeout: 30_000 },
    async () => {
      const copy = copyOf(piernas);
      await assertSucceeds(createFirestoreInbox(asAlice()).create("bob", "again", copy));
      // Stored by an earlier page load that closed before deleting the copy, then edited.
      const sentAt = (await stored("users/bob/inbox/again"))!.sentAt as Timestamp;
      const { id: _id, ...draft } = receivedRoutine("again", {
        ...copy,
        sentAt: sentAt.toMillis(),
      })!;
      const edited = toStoredRoutine({ ...draft, name: "Mis piernas" });
      await seed("users/bob/routines/again", edited);

      const stop = receiveAsBob();
      try {
        await eventually(
          async () => (await stored("users/bob/inbox/again")) === undefined,
          "the copy received again to leave the inbox",
        );
      } finally {
        stop();
      }
      expect(await stored("users/bob/routines/again")).toEqual(edited);
    },
  );

  it(
    "leaves the copy and writes no routine when the routine save is refused (L64)",
    { timeout: 30_000 },
    async () => {
      await assertSucceeds(
        createFirestoreInbox(asAlice()).create("bob", "refused", copyOf(piernas)),
      );
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      // Bob's inbox, but a library writing into Bob's routines as Alice: every write is refused.
      const stop = createInboxReceiver({
        inbox: createFirestoreInboxReader(asBob(), "bob"),
        routines: libraryFor(asAlice()),
      }).start();
      try {
        await eventually(
          () =>
            Promise.resolve(
              errors.mock.calls.some(
                ([said, id]) =>
                  said === "A received routine could not be stored; its copy stays:" &&
                  id === "refused",
              ),
            ),
          "the refusal to be reported",
        );
      } finally {
        stop();
        errors.mockRestore();
      }
      expect(await stored("users/bob/inbox/refused")).toBeDefined();
      expect(await stored("users/bob/routines/refused")).toBeUndefined();
    },
  );

  it(
    "never settles offline, writes nothing that could be sent later, and stores it once back online (L64, T29 W2)",
    { timeout: 30_000 },
    async () => {
      // Offline as a browser is: every call to the server fails. disableNetwork only stops
      // Firestore's listeners and queued writes, not a transaction, so a client of a server that
      // cannot be reached stands for it.
      const app = initializeApp({ projectId: "demo-sportime" }, "offline-receiver");
      const unreachable = getFirestore(app);
      connectFirestoreEmulator(unreachable, "127.0.0.1", 9);
      let running = true;
      let tries = 0;
      const offline = createFirestoreRoutineLibrary(unreachable, "bob", {
        store: memoryStore(),
        whenReady: () => Promise.resolve(true),
        // Tries again at once while the test runs, and never after it.
        wait: () =>
          new Promise<void>((resolve) => {
            tries += 1;
            if (running) setTimeout(resolve, 50);
          }),
      });
      let settled = false;
      void offline
        .receive(receivedAs("offline"))
        .finally(() => {
          settled = true;
        })
        .catch(() => undefined);
      try {
        await eventually(() => Promise.resolve(tries >= 3), "three tries while offline");
        expect(settled).toBe(false);
        expect(await stored("users/bob/routines/offline")).toBeUndefined();
      } finally {
        running = false;
        await terminate(unreachable);
        await deleteApp(app);
      }
      // Nothing was held to be sent later: back online, only a new receive stores it, once.
      expect(await stored("users/bob/routines/offline")).toBeUndefined();
      await libraryFor(asBob()).receive(receivedAs("offline"));
      expect(await stored("users/bob/routines/offline")).toEqual(routine);
    },
  );

  it(
    "never overwrites an edit made elsewhere when the server could not be asked (L64 A2)",
    { timeout: 30_000 },
    async () => {
      // Received and edited on another device; this device's cache has never seen it.
      const edited = { ...routine, name: "Mis piernas" };
      await seed("users/bob/routines/elsewhere", edited);
      const bob = asBob();
      await disableNetwork(bob);
      const receiving = libraryFor(bob).receive(receivedAs("elsewhere"));
      await sleep(500);
      await enableNetwork(bob);
      await receiving;
      expect(await stored("users/bob/routines/elsewhere")).toEqual(edited);
    },
  );

  it(
    "receives a sender whose email has a slash, a space or a quoted @ (T29 W4)",
    { timeout: 30_000 },
    async () => {
      const emails = ["a/b@example.com", '"al ice"@example.com', '"a@b"@example.com'];
      for (const [index, email] of emails.entries()) {
        const result = buildSharedCopy(piernas, { uid: "alice", email, emailVerified: true });
        if (!("copy" in result)) throw new Error(JSON.stringify(result.problems));
        const alice = env
          .authenticatedContext("alice", { email, email_verified: true })
          .firestore() as unknown as Firestore;
        await assertSucceeds(createFirestoreInbox(alice).create("bob", `w4-${index}`, result.copy));
      }
      const stop = receiveAsBob();
      try {
        for (const index of emails.keys()) {
          await eventually(
            async () => (await stored(`users/bob/inbox/w4-${index}`)) === undefined,
            "the copy to leave the inbox",
          );
        }
      } finally {
        stop();
      }
      for (const [index, email] of emails.entries()) {
        expect((await stored(`users/bob/routines/w4-${index}`))?.receivedFrom).toEqual({
          uid: "alice",
          name: "",
          email,
        });
      }
    },
  );

  it(
    "reports a copy the rules accept but the app cannot open, by its sender, and deletes it when asked (T29 W5)",
    { timeout: 30_000 },
    async () => {
      // A link of 304 characters: the rules take up to 592, the app opens at most 300 (L56 A2).
      const copy = copyOf(piernas);
      const long = `https://x.com/${"e".repeat(290)}`;
      const unopenable = {
        ...copy,
        stages: [{ exercises: `Remo\t10\t\t\t\t${long}` }],
      };
      await assertSucceeds(createFirestoreInbox(asAlice()).create("bob", "odd", unopenable));
      const bob = asBob();
      const routines = libraryFor(bob);
      const receiver = createInboxReceiver({
        inbox: createFirestoreInboxReader(bob, "bob"),
        routines,
      });
      const reported: string[][] = [];
      const stop = receiver.start((copies) => {
        reported.push(copies.map(({ id, sender: from }) => `${id} ${from.uid} ${from.email}`));
      });
      try {
        await eventually(
          () => Promise.resolve(reported.some((list) => list.length === 1)),
          "the copy to be reported",
        );
        expect(reported.at(-1)).toEqual([`odd alice ${aliceToken.email}`]);
        expect(await stored("users/bob/routines/odd")).toBeUndefined();
        expect(await stored("users/bob/inbox/odd")).toBeDefined();
        await receiver.discard("odd");
        expect(await stored("users/bob/inbox/odd")).toBeUndefined();
      } finally {
        stop();
      }
    },
  );

  it(
    "stores a received routine with a create-only server write, never queued on this device (T29 W2)",
    { timeout: 30_000 },
    async () => {
      const bob = asBob();
      await libraryFor(bob).receive(receivedAs("w2"));
      expect(await stored("users/bob/routines/w2")).toEqual(routine);
      // Received again after an edit made elsewhere: the server's routine stays as it is.
      const edited = { ...routine, name: "Editada en otro lado" };
      await seed("users/bob/routines/w2", edited);
      await libraryFor(bob).receive(receivedAs("w2"));
      expect(await stored("users/bob/routines/w2")).toEqual(edited);
    },
  );

  it("deleting a received routine deletes its copy left in the inbox (L64 A1)", async () => {
    await assertSucceeds(createFirestoreInbox(asAlice()).create("bob", "left", copyOf(piernas)));
    await seed("users/bob/routines/left", routine);
    await libraryFor(asBob()).remove("left");
    expect(await stored("users/bob/routines/left")).toBeUndefined();
    expect(await stored("users/bob/inbox/left")).toBeUndefined();
  });

  it("deleting a received routine works when its copy is already gone (L64 A1)", async () => {
    await seed("users/bob/routines/gone", routine);
    await libraryFor(asBob()).remove("gone");
    expect(await stored("users/bob/routines/gone")).toBeUndefined();
    expect(await stored("users/bob/inbox/gone")).toBeUndefined();
  });

  it("lets nobody but the recipient read or delete the copy", async () => {
    await assertSucceeds(createFirestoreInbox(asAlice()).create("bob", "mine", copyOf(piernas)));
    await assertFails(getDoc(doc(asAlice(), "users/bob/inbox/mine")));
    await assertFails(deleteDoc(doc(asAlice(), "users/bob/inbox/mine")));
    await assertSucceeds(getDoc(doc(asBob(), "users/bob/inbox/mine")));
  });
});
