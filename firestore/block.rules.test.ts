import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createFirestoreAccountData } from "../src/account/infrastructure/firestoreAccountData";
import { DIRECTORY_LIMITS } from "../src/directory/domain/directory";
import {
  ROUTINE_LIMITS,
  toStoredRoutine,
  type RoutineDraft,
  type StoredRoutine,
} from "../src/routines/domain/routine";
import { createRoutineSharing } from "../src/sharing/application/shareRoutine";
import { createFirestoreInbox } from "../src/sharing/infrastructure/firestoreInbox";

/**
 * Blocking a sender (T27, S7, S12): `users/{uid}/blocked/{senderUid}` holds exactly the name and
 * email shown when blocking, only the owner reads or writes it, and the inbox refuses every copy
 * from a sender the recipient blocked, while the largest copy still fits the rule budget.
 */

let env: RulesTestEnvironment;

const L = ROUTINE_LIMITS;

const aliceToken = {
  email: "alice@example.com",
  email_verified: true,
  name: "Alice Liddell",
  picture: "https://lh3.googleusercontent.com/a/alice=s96-c",
};
const carolToken = { email: "carol@example.com", email_verified: true, name: "Carol" };

type Token = Parameters<RulesTestEnvironment["authenticatedContext"]>[1];

const asAlice = (token: Token = aliceToken) =>
  env.authenticatedContext("alice", token).firestore() as unknown as Firestore;
const asBob = () =>
  env
    .authenticatedContext("bob", { email: "bob@example.com", email_verified: true })
    .firestore() as unknown as Firestore;
const asCarol = () =>
  env.authenticatedContext("carol", carolToken).firestore() as unknown as Firestore;

const blockedPath = (owner: string, senderUid: string) => `users/${owner}/blocked/${senderUid}`;
const inboxPath = (recipient: string, id: string) => `users/${recipient}/inbox/${id}`;

/** What the app stores when Bob blocks Alice: the name and email her routine was received with. */
const aliceBlocked = { name: "Alice Liddell", email: "alice@example.com" };

async function seed(path: string, data: object) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore() as unknown as Firestore, path), data);
  });
}

async function storedAt(path: string): Promise<boolean> {
  let exists = false;
  await env.withSecurityRulesDisabled(async (context) => {
    exists = (await getDoc(doc(context.firestore() as unknown as Firestore, path))).exists();
  });
  return exists;
}

const contact = (uid: string) => ({ uid, name: "", photo: "", email: `${uid}@example.com` });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-sportime",
    firestore: { rules: readFileSync("firestore/firestore.rules", "utf8") },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed("users/alice/contacts/bob", contact("bob"));
  await seed("users/carol/contacts/bob", contact("bob"));
  // Bob lets people find him by email, so copies may reach him (T29 W1).
  await seed("directory/bob@example.com", { uid: "bob", name: "" });
});

afterAll(async () => {
  await env.cleanup();
});

describe("the blocked list (T27, S7)", () => {
  it("lets the owner block, read, list and unblock a sender, with exactly a name and email", async () => {
    const db = asBob();
    const ref = doc(db, blockedPath("bob", "alice"));
    await assertSucceeds(setDoc(ref, aliceBlocked));
    // Blocking again, as an outbox resend or with the name the sender has now, is accepted.
    await assertSucceeds(setDoc(ref, { ...aliceBlocked, name: "Alice" }));
    const read = await assertSucceeds(getDoc(ref));
    expect(read.data()).toEqual({ ...aliceBlocked, name: "Alice" });
    const list = await assertSucceeds(getDocs(collection(db, "users/bob/blocked")));
    expect(list.size).toBe(1);
    await assertSucceeds(deleteDoc(ref));
    expect(await storedAt(blockedPath("bob", "alice"))).toBe(false);
  });

  it("accepts an empty name, and the longest name and email the app keeps", async () => {
    const db = asBob();
    await assertSucceeds(setDoc(doc(db, blockedPath("bob", "a1")), { ...aliceBlocked, name: "" }));
    await assertSucceeds(
      setDoc(doc(db, blockedPath("bob", "u".repeat(L.senderUidLength))), {
        name: "N".repeat(L.senderNameLength),
        email: `${"e".repeat(L.senderEmailLength - 11)}@example.co`,
      }),
    );
  });

  it("accepts every sender email the inbox took from a verified sign-in: '/', spaces, a quoted @ (T29 W4)", async () => {
    const db = asBob();
    for (const [index, email] of [
      "a/b@example.com",
      '"al ice"@example.com',
      '"a@b"@example.com',
      "a@b@c",
    ].entries()) {
      await assertSucceeds(setDoc(doc(db, blockedPath("bob", `s${index}`)), { name: "", email }));
    }
  });

  it("refuses anything but exactly a valid name and email, and blocking oneself", async () => {
    const db = asBob();
    const refused = async (data: object, senderUid = "alice") => {
      await assertFails(setDoc(doc(db, blockedPath("bob", senderUid)), data));
      expect(await storedAt(blockedPath("bob", senderUid))).toBe(false);
    };
    await refused({ ...aliceBlocked, uid: "alice" });
    await refused({ ...aliceBlocked, photo: "" });
    await refused({ name: aliceBlocked.name });
    await refused({ email: aliceBlocked.email });
    await refused({});
    await refused({ ...aliceBlocked, name: 7 });
    await refused({ ...aliceBlocked, name: null });
    await refused({ ...aliceBlocked, name: "N".repeat(L.senderNameLength + 1) });
    await refused({ ...aliceBlocked, name: "Ali\nce" });
    await refused({ ...aliceBlocked, email: 7 });
    await refused({ ...aliceBlocked, email: "" });
    await refused({ ...aliceBlocked, email: "alice" });
    await refused({ ...aliceBlocked, email: "@example.com" });
    await refused({ ...aliceBlocked, email: "alice@" });
    await refused({ ...aliceBlocked, email: "al\nice@example.com" });
    await refused({ ...aliceBlocked, email: "al\u0085ice@example.com" });
    await refused({
      ...aliceBlocked,
      email: `${"e".repeat(L.senderEmailLength - 10)}@example.co`,
    });
    await refused(aliceBlocked, "bob");
    await refused(aliceBlocked, "u".repeat(L.senderUidLength + 1));
  });

  it("is the owner's alone: nobody else may read, list, write or delete it", async () => {
    await seed(blockedPath("bob", "alice"), aliceBlocked);
    for (const db of [
      asAlice(),
      asCarol(),
      env.unauthenticatedContext().firestore() as unknown as Firestore,
    ]) {
      await assertFails(getDoc(doc(db, blockedPath("bob", "alice"))));
      await assertFails(getDocs(collection(db, "users/bob/blocked")));
      await assertFails(deleteDoc(doc(db, blockedPath("bob", "alice"))));
      await assertFails(setDoc(doc(db, blockedPath("bob", "carol")), aliceBlocked));
    }
    expect(await storedAt(blockedPath("bob", "alice"))).toBe(true);
    expect(await storedAt(blockedPath("bob", "carol"))).toBe(false);
  });
});

const routine: RoutineDraft = {
  name: "Piernas",
  createdAt: 1,
  stages: [{ name: "A", exercises: [{ name: "Sentadilla", repsMin: 8, repsMax: 10 }] }],
};

/** The copy a sender writes, as T24's inbox rules take it. */
function copyOf(stored: StoredRoutine, token: { email: string; name: string; picture?: string }) {
  const { createdAt: _createdAt, ...content } = stored;
  return {
    fromUid: token === carolToken ? "carol" : "alice",
    fromEmail: token.email,
    fromName: token.name,
    ...(token.picture === undefined ? {} : { fromPhoto: token.picture }),
    sentAt: serverTimestamp(),
    ...content,
  };
}

const aliceCopy = copyOf(toStoredRoutine(routine), aliceToken);
const carolCopy = copyOf(toStoredRoutine(routine), carolToken);

let nextId = 0;
async function sent(db: Firestore, data: object): Promise<boolean> {
  const id = `copy-${++nextId}`;
  const ok = await setDoc(doc(db, inboxPath("bob", id)), data).then(
    () => true,
    () => false,
  );
  expect(await storedAt(inboxPath("bob", id))).toBe(ok);
  return ok;
}

describe("a blocked sender's copies (T27, S7, S12)", () => {
  it("are refused and nothing is stored, while other senders are unaffected", async () => {
    await seed(blockedPath("bob", "alice"), aliceBlocked);
    expect(await sent(asAlice(), aliceCopy)).toBe(false);
    expect(await sent(asCarol(), carolCopy)).toBe(true);
  });

  it("are accepted before blocking and again once unblocked", async () => {
    expect(await sent(asAlice(), aliceCopy)).toBe(true);
    await assertSucceeds(setDoc(doc(asBob(), blockedPath("bob", "alice")), aliceBlocked));
    expect(await sent(asAlice(), aliceCopy)).toBe(false);
    await assertSucceeds(deleteDoc(doc(asBob(), blockedPath("bob", "alice"))));
    expect(await sent(asAlice(), aliceCopy)).toBe(true);
  });

  it("only count for the recipient who blocked: another recipient still receives them", async () => {
    await seed("users/alice/contacts/dave", contact("dave"));
    await seed("directory/dave@example.com", { uid: "dave", name: "" });
    await seed(blockedPath("bob", "alice"), aliceBlocked);
    // Blocked in someone else's list, or under another uid, changes nothing.
    await seed(blockedPath("dave", "carol"), { name: "Carol", email: "carol@example.com" });
    const ok = await setDoc(doc(asAlice(), inboxPath("dave", "d1")), aliceCopy).then(
      () => true,
      () => false,
    );
    expect(ok).toBe(true);
  });

  it("refuses a blocked sender by every route (L69)", async () => {
    await seed(blockedPath("bob", "alice"), aliceBlocked);
    await seed(inboxPath("bob", "old"), { ...aliceCopy, sentAt: 1 });
    const db = asAlice();

    await assertFails(setDoc(doc(db, inboxPath("bob", "merged")), aliceCopy, { merge: true }));
    const batch = writeBatch(db);
    batch.delete(doc(db, blockedPath("bob", "alice")));
    batch.set(doc(db, inboxPath("bob", "batched")), aliceCopy);
    await assertFails(batch.commit());
    await assertFails(
      runTransaction(
        db,
        (transaction) => {
          transaction.set(doc(db, inboxPath("bob", "transacted")), aliceCopy);
          return Promise.resolve();
        },
        { maxAttempts: 1 },
      ),
    );
    await assertFails(setDoc(doc(db, "users/bob/inbox/x/sub/y"), aliceCopy));
    await assertFails(updateDoc(doc(db, inboxPath("bob", "old")), { name: "Otra" }));
    await assertFails(deleteDoc(doc(db, inboxPath("bob", "old"))));
    await assertFails(getDoc(doc(db, blockedPath("bob", "nobody"))));

    for (const id of ["merged", "batched", "transacted"]) {
      expect(await storedAt(inboxPath("bob", id))).toBe(false);
    }
    expect(await storedAt("users/bob/inbox/x/sub/y")).toBe(false);
    expect(await storedAt(inboxPath("bob", "old"))).toBe(true);
    expect(await storedAt(blockedPath("bob", "alice"))).toBe(true);
  });

  it("a block under another case does not block (L69)", async () => {
    await seed(blockedPath("bob", "Alice"), aliceBlocked);
    expect(await sent(asAlice(), aliceCopy)).toBe(true);
  });

  it("show the sender only the existing refused outcome, through the app's adapter", async () => {
    await seed(blockedPath("bob", "alice"), aliceBlocked);
    const sharing = createRoutineSharing({
      identity: {
        claims: () =>
          Promise.resolve({
            uid: "alice",
            email: aliceToken.email,
            emailVerified: true,
            name: aliceToken.name,
            picture: aliceToken.picture,
          }),
      },
      inbox: createFirestoreInbox(asAlice()),
      online: () => true,
    });
    const prepared = await sharing.prepare(routine, [
      { uid: "bob", name: "Bob", photo: "", email: "bob@example.com" },
    ]);
    if (prepared.kind !== "ready") throw new Error(prepared.kind);
    const [delivery] = await prepared.share.send();
    expect(delivery?.outcome).toBe("refused");
    expect(delivery?.failure).toBeUndefined();
    const inbox = await getDocs(collection(asBob(), "users/bob/inbox"));
    expect(inbox.size).toBe(0);
  });
});

/** Every stage, exercise and text at its limit, with every link at 300 characters. */
function largestRoutine(stages: number = L.stages): StoredRoutine {
  return toStoredRoutine({
    name: "a".repeat(L.nameLength),
    notes: "n".repeat(L.notesLength),
    createdAt: 1,
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
  });
}

const base = "https://lh3.googleusercontent.com/";
const longestToken = {
  ...aliceToken,
  name: "N".repeat(DIRECTORY_LIMITS.nameLength),
  picture: base + "p".repeat(DIRECTORY_LIMITS.photoLength - base.length),
};

describe("the largest copy with the blocked check (T27, L6)", () => {
  it("is still accepted, with the longest sender, while others are blocked", async () => {
    await seed(blockedPath("bob", "carol"), { name: "Carol", email: "carol@example.com" });
    const largest = largestRoutine();
    expect(largest.stages).toHaveLength(L.stages);
    expect(await sent(asAlice(longestToken), copyOf(largest, longestToken))).toBe(true);
  });

  /**
   * How many full stages an inbox create may hold before Firestore stops evaluating the rules
   * (1000 expressions, L6): measured on a copy of the rules whose shared stage limit is lifted, so
   * the cost of everything else, the blocked check included, stays as it is.
   */
  describe("rule budget", () => {
    const LIFTED = 14;
    let lifted: RulesTestEnvironment;

    const liftedRules = () => {
      const rules = readFileSync("firestore/firestore.rules", "utf8");
      const start = rules.indexOf("    function isSharedStages(stages) {");
      const end = rules.indexOf("    }\n", start) + "    }\n".length;
      expect(start).toBeGreaterThan(0);
      const checks = Array.from(
        { length: LIFTED },
        (_, index) => `        && (n < ${index + 1} || isSharedStage(stages[${index}]))`,
      ).join("\n");
      const body = `    function isSharedStages(stages) {\n      let n = stages.size();\n      return stages is list\n        && n <= ${LIFTED}\n${checks};\n    }\n`;
      return rules.slice(0, start) + body + rules.slice(end);
    };

    beforeAll(async () => {
      lifted = await initializeTestEnvironment({
        projectId: "demo-sportime-block-budget",
        firestore: { rules: liftedRules() },
      });
    });

    beforeEach(async () => {
      await lifted.clearFirestore();
      await lifted.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore() as unknown as Firestore;
        await setDoc(doc(db, "users/alice/contacts/bob"), contact("bob"));
        await setDoc(doc(db, "directory/bob@example.com"), { uid: "bob", name: "" });
        await setDoc(doc(db, blockedPath("bob", "carol")), { name: "Carol", email: "c@x.co" });
      });
    });

    afterAll(async () => {
      await lifted.cleanup();
    });

    it(
      "keeps a stage of headroom over the limit of 10 with the longest sender",
      { timeout: 60_000 },
      async () => {
        const db = lifted
          .authenticatedContext("alice", longestToken)
          .firestore() as unknown as Firestore;
        const full = largestRoutine(1);
        let fit = 0;
        for (let stages = 1; stages <= LIFTED; stages++) {
          const copy = {
            ...copyOf(full, longestToken),
            stages: Array.from({ length: stages }, () => full.stages[0]!),
          };
          const ok = await setDoc(doc(db, inboxPath("bob", `budget-${stages}`)), copy).then(
            () => true,
            () => false,
          );
          if (!ok) break;
          fit = stages;
        }
        console.warn(`Inbox create with the blocked check: ${fit} full stages fit`);
        expect(fit).toBeGreaterThan(L.stages);
      },
    );
  });
});

describe("account deletion (T27, S6)", () => {
  it("erases the blocked list with the rest, and no other account's", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    try {
      await seed(blockedPath("bob", "alice"), aliceBlocked);
      await seed(blockedPath("bob", "carol"), { name: "Carol", email: "carol@example.com" });
      await seed(blockedPath("carol", "alice"), aliceBlocked);
      await createFirestoreAccountData({
        db: asBob(),
        userId: "bob",
        email: () => null,
        discardPendingWrites: () => undefined,
      }).erase();
      expect(await storedAt(blockedPath("bob", "alice"))).toBe(false);
      expect(await storedAt(blockedPath("bob", "carol"))).toBe(false);
      expect(await storedAt(blockedPath("carol", "alice"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
