import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { DIRECTORY_LIMITS } from "../src/directory/domain/directory";
import {
  ROUTINE_LIMITS,
  isLocalLink,
  normalizeLink,
  toStoredRoutine,
  type RoutineDraft,
  type StoredRoutine,
} from "../src/routines/domain/routine";

/**
 * The shared-routine inbox (T24, S12): `users/{recipient}/inbox/{copyId}` holds independent
 * copies other users sent. Only a sender who has the recipient in their contacts may create one,
 * with their identity taken from their Google sign-in and the routine checked strictly; nobody
 * may change it; only the recipient may read or delete it.
 */

let env: RulesTestEnvironment;

const L = ROUTINE_LIMITS;

const alice = {
  uid: "alice",
  email: "alice@example.com",
  name: "Alice Liddell",
  picture: "https://lh3.googleusercontent.com/a/alice=s96-c",
};
type Token = { email?: string; email_verified?: boolean; name?: string; picture?: string };
const aliceToken: Token = {
  email: alice.email,
  email_verified: true,
  name: alice.name,
  picture: alice.picture,
};

const signedIn = (uid: string, token: Token = {}) =>
  env.authenticatedContext(uid, token).firestore();
/** Alice, signed in with Google; `token` changes or removes (undefined) claims. */
const asAlice = (token: Token = {}) => {
  const claims: Token = { ...aliceToken, ...token };
  for (const key of Object.keys(claims) as (keyof Token)[]) {
    if (claims[key] === undefined) delete claims[key];
  }
  return signedIn("alice", claims);
};

const inboxPath = (recipient: string, id: string) => `users/${recipient}/inbox/${id}`;
const contactPath = (owner: string, contactUid: string) => `users/${owner}/contacts/${contactUid}`;

const routineDraft: RoutineDraft = {
  name: "Empuje",
  notes: "Calentar bien.\nHombros primero.",
  createdAt: 1_700_000_000_000,
  stages: [
    {
      name: "Bloque A",
      notes: "Sin prisa.",
      exercises: [
        {
          name: "Press banca",
          repsMin: 8,
          repsMax: 10,
          restSeconds: 90,
          weight: 62.5,
          weightUnit: "kg",
          notes: "Pausa abajo",
          link: "https://www.youtube.com/watch?v=abc&t=1s",
        },
        { repsMin: 12 },
      ],
    },
    { exercises: [{ weight: 20, weightUnit: "lb" }] },
  ],
};

/** The copy a sender writes: the routine as stored, without createdAt, and who sent it. */
function copyOf(routine: StoredRoutine): Record<string, unknown> {
  const { createdAt: _createdAt, ...content } = routine;
  return {
    fromUid: alice.uid,
    fromEmail: alice.email,
    fromName: alice.name,
    fromPhoto: alice.picture,
    sentAt: serverTimestamp(),
    ...content,
  };
}

const copy = copyOf(toStoredRoutine(routineDraft));
const withStages = (stages: unknown[]) => ({ ...copy, stages });
const withStage = (stage: object) => withStages([stage]);
const withLines = (exercises: string) => withStage({ exercises });
const lineWithLink = (link: string) => `Remo\t10\t\t\t\t${link}`;

let nextId = 0;
const send = (data: object, db = asAlice(), recipient = "bob", id = `copy-${++nextId}`) =>
  setDoc(doc(db, inboxPath(recipient, id)), data);

async function storedAt(path: string): Promise<boolean> {
  let exists = false;
  await env.withSecurityRulesDisabled(async (context) => {
    exists = (await getDoc(doc(context.firestore(), path))).exists();
  });
  return exists;
}

/** The write is refused and leaves nothing stored. */
async function refused(data: object, db = asAlice(), recipient = "bob") {
  const id = `copy-${++nextId}`;
  await assertFails(send(data, db, recipient, id));
  expect(await storedAt(inboxPath(recipient, id))).toBe(false);
}

async function accepted(data: object, db = asAlice(), recipient = "bob") {
  const id = `copy-${++nextId}`;
  await assertSucceeds(send(data, db, recipient, id));
  expect(await storedAt(inboxPath(recipient, id))).toBe(true);
}

async function seed(path: string, data: object) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

const bobContact = { uid: "bob", name: "Bob", photo: "", email: "bob@example.com" };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-sportime",
    firestore: { rules: readFileSync("firestore/firestore.rules", "utf8") },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(contactPath("alice", "bob"), bobContact);
});

afterAll(async () => {
  await env.cleanup();
});

/** Every stage, exercise and text at its limit, with every link at 300 characters. */
function largestRoutine(link: string): StoredRoutine {
  return toStoredRoutine({
    name: "a".repeat(L.nameLength),
    notes: "n".repeat(L.notesLength),
    createdAt: 1,
    stages: Array.from({ length: L.stages }, () => ({
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
        link,
      })),
    })),
  });
}

describe("sending a copy (T24, S12)", () => {
  it("accepts a copy from a sender who has the recipient in their contacts", async () => {
    await accepted(copy);
  });

  it("stores the sender as signed in with Google and the server's time", async () => {
    const before = Date.now();
    await assertSucceeds(send(copy, asAlice(), "bob", "c1"));
    const read = await assertSucceeds(getDoc(doc(signedIn("bob"), inboxPath("bob", "c1"))));
    const data = read.data() as Record<string, unknown>;
    expect(data).toMatchObject({
      fromUid: "alice",
      fromEmail: alice.email,
      fromName: alice.name,
      fromPhoto: alice.picture,
      name: "Empuje",
    });
    expect(data.sentAt).toBeInstanceOf(Timestamp);
    expect((data.sentAt as Timestamp).toMillis()).toBeGreaterThanOrEqual(before - 60_000);
  });

  it("accepts a copy without notes, stages or photo, and a stage with only a name", async () => {
    const { notes: _notes, fromPhoto: _photo, ...bare } = copy;
    await accepted({ ...bare, stages: [] });
    await accepted(withStage({ name: "Solo el nombre", exercises: "" }));
    await accepted(withStage({ notes: "Solo notas", exercises: "" }));
  });

  it("accepts the largest copy: 10 full stages, every text and link at its limit", async () => {
    const longest = `https://x.com/${"e".repeat(L.linkLength - 14)}`;
    const site = "https://www.youtube.com/watch?v=";
    const onSite = site + "v".repeat(L.linkLength - site.length);
    for (const link of [longest, onSite]) {
      expect(link).toHaveLength(L.linkLength);
      expect(normalizeLink(link)).toBe(link);
      const largest = largestRoutine(link);
      expect(largest.stages).toHaveLength(L.stages);
      expect(largest.stages[L.stages - 1]!.exercises.split("\n")).toHaveLength(L.exercisesPerStage);
      expect(largest.stages[0]!.exercises).toContain(`\t${link}\n`);
      const base = "https://lh3.googleusercontent.com/";
      const picture = base + "p".repeat(DIRECTORY_LIMITS.photoLength - base.length);
      const name = "N".repeat(DIRECTORY_LIMITS.nameLength);
      await accepted(
        { ...copyOf(largest), fromName: name, fromPhoto: picture },
        asAlice({ name, picture }),
      );
    }
  });

  it("accepts multibyte text the app writes", async () => {
    const e = "\u{1F4AA}";
    await accepted(
      copyOf(
        toStoredRoutine({
          name: e.repeat(20),
          notes: e.repeat(250),
          createdAt: 1,
          stages: [
            {
              name: e.repeat(20),
              notes: e.repeat(250),
              exercises: [{ name: e.repeat(20), notes: e.repeat(60), weight: 0 }],
            },
          ],
        }),
      ),
    );
  });

  it("accepts every exercise field on its own, and ordered rep ranges", async () => {
    for (const line of [
      "Remo\t\t\t\t\t",
      "\t10\t\t\t\t",
      "\t8-10\t\t\t\t",
      "\t9-10\t\t\t\t",
      "\t99-100\t\t\t\t",
      "\t998-999\t\t\t\t",
      "\t1-999\t\t\t\t",
      "\t109-110\t\t\t\t",
      "\t\t0\t\t\t",
      "\t\t3600\t\t\t",
      "\t\t\t0kg\t\t",
      "\t\t\t1000lb\t\t",
      "\t\t\t\tlento\t",
      "\t\t\t\t\thttps://youtu.be/abc",
      "a\t\t\t\t\t\nb\t\t\t\t\t",
    ]) {
      await accepted(withLines(line));
    }
  });

  it("accepts links to named sites: paths, queries, ports and a trailing dot", async () => {
    for (const link of [
      "https://youtube.com/watch?v=abc",
      "https://www.youtube.com/watch?v=abc&t=1s",
      "https://www.youtube.com/@canal",
      "https://www.instagram.com/p/C1a2b3c4d5/",
      "https://youtu.be/abc",
      "https://example.io:8443/x",
      "https://a-b.example.co.uk/p?q=1#h",
      "https://EXAMPLE.COM.",
      "https://xn--bcher-kva.de/x",
      "https://localhost.com/x",
      "https://local.example.org",
      "https://lan.party.net",
      "https://lana.app",
      "https://internals.dev",
      "https://123.example.com",
      "https://0xdead.beef.io",
      "https://3232235521.com",
      "https://localhost.example.com",
      "https://router.local.example.com:8443/x",
      "https://192.168.0.1.nip.io/",
    ]) {
      expect(normalizeLink(link), link).toBe(link);
      await accepted(withLines(lineWithLink(link)));
      await accepted(withLines(`a\t\t\t\t\thttps://x.com\n${lineWithLink(link)}`));
    }
  }, 60_000);
});

describe("who may send (T24, S12, S7)", () => {
  it("refuses anyone signed out", async () => {
    await refused(copy, env.unauthenticatedContext().firestore());
  });

  it("refuses sending to yourself, even with yourself in your contacts", async () => {
    await seed(contactPath("alice", "alice"), { ...bobContact, uid: "alice" });
    await refused(copy, asAlice(), "alice");
  });

  it("refuses a recipient who is not in the sender's contacts", async () => {
    await refused(copy, asAlice(), "carol");
  });

  it("refuses when only someone else has the recipient in their contacts", async () => {
    await seed(contactPath("carol", "dave"), { ...bobContact, uid: "dave" });
    await refused(copy, asAlice(), "dave");
    const mallory = { ...aliceToken, email: "mallory@example.com", name: "Mallory" };
    await refused(
      { ...copy, fromUid: "mallory", fromEmail: mallory.email, fromName: mallory.name },
      signedIn("mallory", mallory),
    );
  });

  it("refuses a sender whose email is not verified", async () => {
    await refused(copy, asAlice({ email_verified: false }));
    await refused(copy, asAlice({ email_verified: undefined }));
  });
});

describe("the sender's identity cannot be forged (T24, S12)", () => {
  it("refuses another uid", async () => {
    await refused({ ...copy, fromUid: "carol" });
  });

  it("refuses another email, or one when the sign-in has none", async () => {
    await refused({ ...copy, fromEmail: "carol@example.com" });
    await refused({ ...copy, fromEmail: "Alice@example.com" });
    await refused(copy, asAlice({ email: undefined, email_verified: true }));
  });

  it("refuses another name", async () => {
    await refused({ ...copy, fromName: "Carol" });
    await refused({ ...copy, fromName: `${alice.name} ` });
    await refused({ ...copy, fromName: "" });
  });

  it("takes an empty name when the sign-in has none", async () => {
    await accepted({ ...copy, fromName: "" }, asAlice({ name: undefined }));
    await refused({ ...copy, fromName: "Alice" }, asAlice({ name: undefined }));
  });

  it("refuses another photo, or one when the sign-in has none", async () => {
    await refused({ ...copy, fromPhoto: "https://lh3.googleusercontent.com/a/carol=s96-c" });
    await refused(copy, asAlice({ picture: undefined }));
    const { fromPhoto: _photo, ...withoutPhoto } = copy;
    await accepted(withoutPhoto, asAlice({ picture: undefined }));
  });

  it("refuses a photo that is not on googleusercontent.com, even the sign-in's own", async () => {
    const picture = "https://example.com/alice.png";
    await refused({ ...copy, fromPhoto: picture }, asAlice({ picture }));
    const { fromPhoto: _photo, ...withoutPhoto } = copy;
    await accepted(withoutPhoto, asAlice({ picture }));
  });

  it("refuses a name the app would not show: too long or with control characters", async () => {
    for (const name of ["N".repeat(DIRECTORY_LIMITS.nameLength + 1), "Alice\nLiddell"]) {
      await refused({ ...copy, fromName: name }, asAlice({ name }));
    }
  });
});

describe("the time it was sent (T24)", () => {
  it("must be the server's time of the write", async () => {
    await refused({ ...copy, sentAt: Timestamp.now() });
    await refused({ ...copy, sentAt: Timestamp.fromMillis(Date.now() + 86_400_000) });
    await refused({ ...copy, sentAt: Date.now() });
    const { sentAt: _sentAt, ...withoutTime } = copy;
    await refused(withoutTime);
  });
});

describe("the copy's fields (T24, S5)", () => {
  it("refuses an extra key at the top or in a stage", async () => {
    await refused({ ...copy, createdAt: 1 });
    await refused({ ...copy, toUid: "bob" });
    await refused({ ...copy, contacts: [bobContact] });
    await refused(withStage({ exercises: "", html: "<b>" }));
  });

  it("refuses a copy missing any required key", async () => {
    for (const key of ["fromUid", "fromEmail", "fromName", "sentAt", "name", "stages"]) {
      const { [key]: _gone, ...rest } = copy;
      await refused(rest);
    }
    await refused(withStage({ name: "Sin ejercicios" }));
  });

  it("refuses values of the wrong type at each level", async () => {
    for (const data of [
      { ...copy, fromUid: 7 },
      { ...copy, fromEmail: null },
      { ...copy, fromName: ["Alice"] },
      { ...copy, fromPhoto: null },
      { ...copy, name: 7 },
      { ...copy, notes: ["a"] },
      { ...copy, stages: "not a list" },
      { ...copy, stages: { 0: { exercises: "" } } },
      withStages(["x"]),
      withStages([null]),
      withStage({ exercises: 5 }),
      withStage({ exercises: ["x\t\t\t\t\t"] }),
      withStage({ name: 5, exercises: "" }),
      withStage({ notes: ["a"], exercises: "" }),
      withStages([...Array(9).fill({ exercises: "Remo\t\t\t\t\t" }), { exercises: 5 }]),
    ]) {
      await refused(data);
    }
  });
});

describe("the routine is checked strictly (T24, L7 A1)", () => {
  const blanks = ["", " ", "   ", "\u3000", "\u00a0", "\u200b", "\u200b\u200c", "\ufeff"];

  it("refuses a blank or invisible routine name", async () => {
    for (const name of blanks) await refused({ ...copy, name });
  });

  it("refuses a blank or invisible stage name", async () => {
    for (const name of blanks) await refused(withStage({ name, exercises: "Remo\t\t\t\t\t" }));
  });

  it("refuses blank or invisible notes on the routine or a stage", async () => {
    for (const notes of [...blanks, "\n", " \n "]) {
      await refused({ ...copy, notes });
      await refused(withStage({ notes, exercises: "Remo\t\t\t\t\t" }));
    }
  });

  it("refuses a stage with nothing in it", async () => {
    await refused(withStage({ exercises: "" }));
    await refused(withStages([...(copy.stages as object[]), { exercises: "" }]));
  });

  it("refuses reversed or equal rep ranges", async () => {
    for (const reps of [
      "10-8",
      "10-10",
      "2-1",
      "1-1",
      "999-1",
      "100-99",
      "21-12",
      "110-109",
      "999-999",
      "100-9",
    ]) {
      await refused(withLines(`\t${reps}\t\t\t\t`));
      await refused(withLines(`a\t\t\t\t\t\nRemo\t${reps}\t90\t\t\t`));
    }
  }, 60_000);

  it("refuses an empty exercise line, wherever it is", async () => {
    for (const exercises of [
      "\t\t\t\t\t",
      "a\t\t\t\t\t\n\t\t\t\t\t",
      "\t\t\t\t\t\na\t\t\t\t\t",
      "a\t\t\t\t\t\n\t\t\t\t\t\nb\t\t\t\t\t",
      "a\t\t\t\t\t\n",
      "\na\t\t\t\t\t",
      "a\t\t\t\t\t\n\nb\t\t\t\t\t",
      "\n",
    ]) {
      await refused(withLines(exercises));
    }
  }, 60_000);

  it("refuses an exercise name or notes that is blank or invisible", async () => {
    for (const text of blanks.slice(1)) {
      await refused(withLines(`${text}\t10\t\t\t\t`));
      await refused(withLines(`Remo\t\t\t\t${text}\t`));
    }
  });

  it("refuses malformed exercise lines, as for one's own routines", async () => {
    for (const line of [
      "Remo\t\t\t\t",
      "Remo\t\t\t\t\t\t",
      "\t0\t\t\t\t",
      "\t010\t\t\t\t",
      "\t8 - 10\t\t\t\t",
      "\t\t1:30\t\t\t",
      "\t\t0900\t\t\t",
      "\t\t\t60\t\t",
      "\t\t\t60KG\t\t",
      "\t\t\t62.55kg\t\t",
      "a\u0007b\t\t\t\t\t",
      "a\t\t\t\t\t\r\nb\t\t\t\t\t",
      "a\t\t\t\t\thttps://u@x.com",
    ]) {
      await refused(withLines(line));
    }
  }, 60_000);

  it("keeps every limit: stages, exercises, lengths and numbers", async () => {
    const line = "x\t\t\t\t\t";
    const lines = (count: number) => Array.from({ length: count }, () => line).join("\n");
    await accepted(withLines(lines(L.exercisesPerStage)));
    await refused(withLines(lines(L.exercisesPerStage + 1)));
    await accepted(withStages(Array.from({ length: L.stages }, () => ({ exercises: line }))));
    await refused(withStages(Array.from({ length: L.stages + 1 }, () => ({ exercises: line }))));
    await accepted({ ...copy, name: "a".repeat(L.nameLength) });
    await refused({ ...copy, name: "a".repeat(L.nameLength + 1) });
    await accepted({ ...copy, notes: "n".repeat(L.notesLength) });
    await refused({ ...copy, notes: "n".repeat(L.notesLength + 1) });
    await refused(withStage({ name: "b".repeat(L.stageNameLength + 1), exercises: line }));
    await refused(withStage({ notes: "m".repeat(L.notesLength + 1), exercises: line }));
    await refused(withLines(`${"c".repeat(L.exerciseNameLength + 1)}\t\t\t\t\t`));
    await refused(withLines(`\t\t\t\t${"d".repeat(L.exerciseNotesLength + 1)}\t`));
    await refused(withLines(`\t${L.reps.max + 1}\t\t\t\t`));
    await refused(withLines(`\t1-${L.reps.max + 1}\t\t\t\t`));
    await refused(withLines(`\t\t${L.restSeconds.max + 1}\t\t\t`));
    await refused(withLines(`\t\t\t${L.weight.max + 0.5}kg\t\t`));
    await refused(withLines(lineWithLink(`https://${"e".repeat(L.linkLength)}.com`)));
    await refused(withLines(lineWithLink(`https://x.com/${"e".repeat(L.linkLength)}`)));
  }, 60_000);
});

describe("links in a copy (T24, S12, S9)", () => {
  /** The same links the owner's rules refuse (T23, L51, L53). */
  const local = [
    "https://localhost",
    "https://LocalHost:5173/x",
    "https://app.localhost",
    "https://localhost.",
    "https://192.168.0.1",
    "https://8.8.8.8",
    "https://192.168.0.1:8080/admin",
    "https://8.8.8.8.",
    "https://3232235521",
    "https://0xC0A80001",
    "https://0xc0a80001/x",
    "https://0xC0.0250.0.1",
    "https://0300.0250.0.1",
    "https://127.1",
    "https://10.1.1",
    "https://[::1]",
    "https://[2001:db8::1]:8443/x",
    "https://[::ffff:192.168.0.1]",
    "https://router",
    "https://router:8080/admin",
    "https://router.",
    "https://www",
    "https://nas.local",
    "https://NAS.LOCAL/fotos",
    "https://printer.lan",
    "https://db.internal:8443",
    "https://box.home.arpa",
    "https://box.Home.Arpa.",
    "https://nas\u3002local",
    "https://192\uff0e168\uff0e0\uff0e1",
    "https://192.168.0.1./",
    "https://0XC0A80001",
    "https://LOCALHOST",
    "https://LOCALHOST.:443",
    "https://printer.LOCAL",
    "https://a.home.arpa./",
    "https://127.1:80",
    "https://4294967295",
  ];

  /**
   * Links the owner's rules still accept (L53 A1) that a browser reads as a local or IP host:
   * full-width digits, letters and dots, other dots, enclosed and styled characters, and a
   * percent escape in the host. A copy's host may hold only ASCII letters, digits, - and .
   */
  const disguised = [
    "https://\uff11\uff19\uff12\uff0e\uff11\uff16\uff18\uff0e\uff10\uff0e\uff11",
    "https://\uff52\uff4f\uff55\uff54\uff45\uff52\uff0e\uff4c\uff4f\uff43\uff41\uff4c",
    "https://a.\u24db\u24d0\u24dd",
    "https://192.168.0\u2488",
    "https://127.0.0.\uff11",
    "https://app.\uff4c\uff4f\uff43\uff41\uff4c\uff48\uff4f\uff53\uff54",
    "https://nas.\uff4c\uff41\uff4e",
    "https://db.\uff49\uff4e\uff54\uff45\uff52\uff4e\uff41\uff4c",
    "https://box.\uff48\uff4f\uff4d\uff45.\uff41\uff52\uff50\uff41",
    "https://192.168.0.\u2460",
    "https://192.168.0\ufe521",
    "https://\u{1d7cf}\u{1d7d7}\u{1d7d0}.\u{1d7cf}\u{1d7d4}\u{1d7d6}.\u{1d7ce}.\u{1d7cf}",
    "https://x.\u24db\u24de\u24d2\u24d0\u24db",
    "https://1.0x\uff430",
    "https://192.168.0.%31",
    "https://you%2Ecom",
    "https://192%2E168%2E0%2E1",
  ];

  it("refuses each local or IP link, alone or after another line", async () => {
    for (const link of local) {
      expect(isLocalLink(link), link).toBe(true);
      await refused(withLines(lineWithLink(link)));
      await refused(withLines(`a\t\t\t\t\thttps://x.com\n${lineWithLink(link)}`));
    }
  }, 60_000);

  it("refuses the disguised forms and percent escapes the app refuses", async () => {
    for (const link of disguised) {
      expect(normalizeLink(link), link).toBeNull();
      await refused(withLines(lineWithLink(link)));
      await refused(withLines(`a\t\t\t\t\thttps://x.com\n${lineWithLink(link)}`));
    }
  }, 60_000);

  it("refuses any other non-ASCII host, even of a named site", async () => {
    for (const link of [
      "https://youtube\u3002com",
      "https://youtube\uff0ecom",
      "https://b\u00fccher.de",
      "https://example.co\u212a",
      "https://example.\u017fite",
      "https://\u0430pple.com",
    ]) {
      await refused(withLines(lineWithLink(link)));
    }
  });

  it("refuses a top-level name that is not letters only (or xn--), and .arpa", async () => {
    for (const link of [
      "https://a.0xg",
      "https://example.c0m",
      "https://example.c",
      "https://example.-com",
      "https://in-addr.arpa",
      "https://x.ARPA",
    ]) {
      await refused(withLines(lineWithLink(link)));
    }
  });

  it("refuses a link that is not https, holds credentials or spaces, or a bad host or port", async () => {
    for (const link of [
      "http://x.com",
      "javascript:alert(1)",
      "HTTPS://X.COM",
      "https://user:pw@x.com",
      "https://@x.com",
      "https:// x.com",
      "https://x.com/a b",
      "https://x.com/a\u00a0b",
      "https://x.com/a\u200bb",
      "https://",
      "https:///x",
      "https://.com",
      "https://-x.com",
      "https://www.",
      "https://x.com:abc",
      "https://x.com:123456",
      "https://x_y.com",
    ]) {
      await refused(withLines(lineWithLink(link)));
    }
  }, 60_000);

  it("reads only the link field, not notes that look like a link", async () => {
    await accepted(withLines("Remo\t\t\t\thttps://router/x\thttps://youtu.be/abc"));
    await accepted(withLines("https://localhost/x\t\t\t\t\t"));
  });
});

describe("after it is sent (T24, S12)", () => {
  const path = inboxPath("bob", "c1");
  const stored = { ...copy, sentAt: Timestamp.fromMillis(1_700_000_000_000) };

  beforeEach(async () => {
    await seed(path, stored);
  });

  it("lets the recipient read, list and delete it", async () => {
    const db = signedIn("bob");
    const read = await assertSucceeds(getDoc(doc(db, path)));
    expect(read.data()).toMatchObject({ fromUid: "alice", name: "Empuje" });
    const list = await assertSucceeds(getDocs(collection(db, "users/bob/inbox")));
    expect(list.size).toBe(1);
    await assertSucceeds(deleteDoc(doc(db, path)));
    expect(await storedAt(path)).toBe(false);
  });

  it("never lets anyone change it, the recipient and the sender included", async () => {
    for (const db of [signedIn("bob"), asAlice()]) {
      await assertFails(setDoc(doc(db, path), stored));
      await assertFails(setDoc(doc(db, path), { ...copy, name: "Otra" }));
      await assertFails(updateDoc(doc(db, path), { name: "Otra" }));
    }
    let data: unknown;
    await env.withSecurityRulesDisabled(async (context) => {
      data = (await getDoc(doc(context.firestore(), path))).data();
    });
    expect(data).toMatchObject({ name: "Empuje" });
  });

  it("hides it from the sender, other users and anyone signed out", async () => {
    for (const db of [asAlice(), signedIn("carol"), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(getDocs(collection(db, "users/bob/inbox")));
      await assertFails(deleteDoc(doc(db, path)));
    }
    expect(await storedAt(path)).toBe(true);
    await assertFails(getDocs(collectionGroup(signedIn("bob"), "inbox")));
  });
});

describe("verifier probes (T24)", () => {
  // Characters the rules engine's Unicode tables may not know: they passed [^\p{C}\p{Z}] while the app sees nothing.
  const invisible = [
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
    "\u2066\u2069",
    "\u061c",
    "\u08e2",
    "\u0890",
    "\u{110cd}",
    "\u{13430}",
    "\u{1bca0}",
    "\u2065",
    "\u{e0080}",
    "\ufffe",
  ];

  it("refuses texts with nothing the app shows", async () => {
    for (const t of invisible) {
      await refused({ ...copy, name: t });
      await refused({ ...copy, notes: t });
      await refused(withStage({ name: t, exercises: "Remo\t\t\t\t\t" }));
      await refused(withStage({ notes: t, exercises: "Remo\t\t\t\t\t" }));
      await refused(withLines(`${t}\t\t\t\t\t`));
      await refused(withLines(`Remo\t\t\t\t${t}\t`));
    }
  }, 120_000);

  it("still accepts texts that start with an emoji, in every text field", async () => {
    for (const t of ["\u{1F4AA} Piernas", "\u{1FAE8} Core"]) {
      await accepted({ ...copy, name: t });
      await accepted({ ...copy, notes: t });
      await accepted(withStage({ name: t, exercises: "Remo\t\t\t\t\t" }));
      await accepted(withStage({ notes: t, exercises: "Remo\t\t\t\t\t" }));
      await accepted(withLines(`${t}\t\t\t\t\t`));
      await accepted(withLines(`Remo\t\t\t\t${t}\t`));
    }
  }, 60_000);

  it("refuses a copy in the same batch that adds the contact", async () => {
    await env.clearFirestore();
    await seed("directory/bob@example.com", { uid: "bob", name: "Bob" });
    const db = asAlice();
    const batch = writeBatch(db);
    batch.set(doc(db, contactPath("alice", "bob")), bobContact);
    batch.set(doc(db, inboxPath("bob", "b1")), copy);
    await assertFails(batch.commit());
    expect(await storedAt(inboxPath("bob", "b1"))).toBe(false);
  });

  it("refuses look-alike photos, a string email_verified, and merges into a sent copy", async () => {
    for (const picture of [
      "https://googleusercontent.com.evil.com/a",
      "https://lh3.googleusercontent.com@evil.com/a",
      "https://evilgoogleusercontent.com/a",
      "https://lh3.googleusercontent.com:443/a",
      "http://lh3.googleusercontent.com/a",
    ]) {
      await refused({ ...copy, fromPhoto: picture }, asAlice({ picture }));
    }
    await refused(copy, asAlice({ email_verified: "true" as unknown as boolean }));
    await assertSucceeds(send(copy, asAlice(), "bob", "s1"));
    await assertFails(
      setDoc(doc(asAlice(), inboxPath("bob", "s1")), { name: "Otra" }, { merge: true }),
    );
    await assertFails(setDoc(doc(signedIn("bob"), inboxPath("bob", "s1")), {}, { merge: true }));
  });
});
