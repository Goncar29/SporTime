import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { ROUTINE_LIMITS, toStoredRoutine, type RoutineDraft } from "../src/routines/domain/routine";
import {
  buildSharedCopy,
  storedCopyProblems,
  type SenderClaims,
  type SharedCopy,
} from "../src/sharing/domain/sharedCopy";
import { createFirestoreInbox } from "../src/sharing/infrastructure/firestoreInbox";

/**
 * Sending a routine (T25, S12) through the app's real write path: the copy built by the domain
 * (buildSharedCopy) and written by the Firestore adapter (createFirestoreInbox: a one-attempt
 * transaction with the server's time) against the real inbox rules (T24).
 */

let env: RulesTestEnvironment;

const L = ROUTINE_LIMITS;

type Token = { email?: string; email_verified?: boolean; name?: string; picture?: string };

const aliceToken = {
  email: "Alice@Example.com",
  email_verified: true,
  name: "Alice Liddell",
  picture: "https://lh3.googleusercontent.com/a/alice=s96-c",
};

/** Alice signed in with Google; `changes` replaces or removes (undefined) claims. */
function tokenOf(changes: Token = {}): Token {
  const claims: Token = { ...aliceToken, ...changes };
  for (const key of Object.keys(claims) as (keyof Token)[]) {
    if (claims[key] === undefined) delete claims[key];
  }
  return claims;
}

const asAlice = (token: Token): Firestore =>
  env.authenticatedContext("alice", token).firestore() as unknown as Firestore;

/** The sender exactly as that token's claims say, as the Firebase identity adapter reads them. */
const claimsOf = (token: Token): SenderClaims => ({
  uid: "alice",
  ...(token.email === undefined ? {} : { email: token.email }),
  emailVerified: token.email_verified === true,
  ...(token.name === undefined ? {} : { name: token.name }),
  ...(token.picture === undefined ? {} : { picture: token.picture }),
});

function build(routine: RoutineDraft, token: Token): SharedCopy {
  const result = buildSharedCopy(routine, claimsOf(token));
  if (!("copy" in result)) throw new Error(`Refused: ${JSON.stringify(result.problems)}`);
  return result.copy;
}

const inboxPath = (recipient: string, id: string) => `users/${recipient}/inbox/${id}`;

async function seed(path: string, data: object) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore() as unknown as Firestore, path), data);
  });
}

async function stored(path: string): Promise<Record<string, unknown> | undefined> {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDoc(doc(context.firestore() as unknown as Firestore, path));
    data = snapshot.data();
  });
  return data;
}

let nextId = 0;
/** Writes `copy` to `recipient` with the app's adapter, as Alice with `token`. */
function send(copy: SharedCopy, token: Token = aliceToken, recipient = "bob", id = `c${++nextId}`) {
  return createFirestoreInbox(asAlice(token)).create(recipient, id, copy);
}

/** The stored copy is the built one, with the server's time as sentAt and nothing else. */
async function expectStored(id: string, copy: SharedCopy) {
  const data = await stored(inboxPath("bob", id));
  expect(data).toBeDefined();
  const { sentAt, ...rest } = data ?? {};
  expect(sentAt).toBeInstanceOf(Timestamp);
  expect(rest).toEqual(copy);
}

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
});

afterAll(async () => {
  await env.cleanup();
});

const piernas: RoutineDraft = {
  name: "Piernas",
  notes: "Calentar bien.\nRodillas primero.",
  createdAt: 1_700_000_000_000,
  stages: [
    {
      name: "Bloque A",
      notes: "Sin prisa.\nControlar la bajada.",
      exercises: [
        {
          name: "Sentadilla",
          repsMin: 8,
          repsMax: 10,
          restSeconds: 90,
          weight: 62.5,
          weightUnit: "kg",
          notes: "Pausa abajo",
          link: "https://www.youtube.com/watch?v=abc&t=1s",
        },
        { name: "Zancadas", repsMin: 12, restSeconds: 60, weight: 20, weightUnit: "lb" },
        { name: "Libro", link: "https://bücher.de/libro" },
      ],
    },
    { name: "Core", exercises: [{ name: "Plancha", restSeconds: 45 }, { repsMin: 15 }] },
    { notes: "Estirar cinco minutos.", exercises: [] },
  ],
};

describe("a copy written by the app's adapter (T25, S12)", () => {
  it("is accepted and stored exactly as built, with the link host in punycode", async () => {
    const copy = build(piernas, aliceToken);
    expect(copy.stages[0]?.exercises).toContain("\thttps://xn--bcher-kva.de/libro");
    await assertSucceeds(send(copy, aliceToken, "bob", "full"));
    await expectStored("full", copy);
    const data = await stored(inboxPath("bob", "full"));
    expect(Object.keys(data ?? {}).sort()).toEqual(
      ["fromEmail", "fromName", "fromPhoto", "fromUid", "name", "notes", "sentAt", "stages"].sort(),
    );
    expect(data).toMatchObject({
      fromUid: "alice",
      fromEmail: "Alice@Example.com",
      fromName: "Alice Liddell",
      fromPhoto: aliceToken.picture,
    });
  });

  it("is accepted from a sign-in without a picture, leaving fromPhoto out", async () => {
    const token = tokenOf({ picture: undefined });
    const copy = build(piernas, token);
    expect("fromPhoto" in copy).toBe(false);
    await assertSucceeds(send(copy, token, "bob", "nophoto"));
    await expectStored("nophoto", copy);
  });

  it("is accepted from a sign-in without a name, with an empty fromName", async () => {
    const token = tokenOf({ name: undefined });
    const copy = build(piernas, token);
    expect(copy.fromName).toBe("");
    await assertSucceeds(send(copy, token, "bob", "noname"));
    await expectStored("noname", copy);
  });

  it("is accepted at the largest routine the domain builds: 10 stages of 15 full exercises", async () => {
    const largest: RoutineDraft = {
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
          weight: L.weight.max,
          weightUnit: "lb" as const,
          notes: "d".repeat(L.exerciseNotesLength),
          link: `https://x.com/${"e".repeat(L.linkLength - 14)}`,
        })),
      })),
    };
    const copy = build(largest, aliceToken);
    expect(copy.stages).toHaveLength(L.stages);
    expect(copy.stages[9]?.exercises.split("\n")).toHaveLength(L.exercisesPerStage);
    await assertSucceeds(send(copy, aliceToken, "bob", "largest"));
    await expectStored("largest", copy);
  });

  it("is never written twice: a second write with the same copy id is refused (may have arrived)", async () => {
    const copy = build(piernas, aliceToken);
    await assertSucceeds(send(copy, aliceToken, "bob", "once"));
    const before = await stored(inboxPath("bob", "once"));
    await assertFails(send(copy, aliceToken, "bob", "once"));
    await assertFails(send({ ...copy, name: "Otra" }, aliceToken, "bob", "once"));
    expect(await stored(inboxPath("bob", "once"))).toEqual(before);
  });

  it("is refused for someone who is not in the sender's contacts, and nothing is stored", async () => {
    const copy = build(piernas, aliceToken);
    await assertFails(send(copy, aliceToken, "carol", "carol1"));
    expect(await stored(inboxPath("carol", "carol1"))).toBeUndefined();
  });
});

/**
 * Every case the domain accepts in src/sharing/domain/rulesAgreement.test.ts (its lists are kept
 * in that test, so they are repeated here), written through the adapter: the rules must accept
 * each, or the app would send a copy the server refuses.
 */
describe("what the domain accepts, the rules accept through the adapter", () => {
  const base = toStoredRoutine({
    name: "Empuje",
    notes: "Calentar bien.\nHombros primero.",
    createdAt: 1,
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
  });
  type Content = Parameters<typeof storedCopyProblems>[0];
  const content: Content = { name: base.name, notes: base.notes, stages: base.stages };
  const withStage = (stage: Content["stages"][number]) => ({ ...content, stages: [stage] });
  const withLines = (exercises: string) => withStage({ exercises });
  const lineWithLink = (link: string) => `Remo\t10\t\t\t\t${link}`;
  const from = {
    fromUid: "alice",
    fromEmail: aliceToken.email,
    fromName: aliceToken.name,
    fromPhoto: aliceToken.picture,
  };

  /** The domain accepts it; then the adapter writes it and the rules must accept it. */
  async function bothAccept(accepted: Content, label: string) {
    expect(storedCopyProblems(accepted), label).toEqual([]);
    // Only the routine's content: a stored routine's createdAt is never part of a copy.
    const { name, notes, stages } = accepted;
    const copy: SharedCopy = {
      ...from,
      name,
      ...(notes === undefined ? {} : { notes }),
      stages: [...stages],
    };
    const id = `a${++nextId}`;
    try {
      await send(copy, aliceToken, "bob", id);
    } catch (error) {
      throw new Error(`Rules refused what the domain accepts: ${label}`, { cause: error });
    }
    expect(await stored(inboxPath("bob", id)), label).toBeDefined();
  }

  it("the copy of a stored routine, and stages with only a name or notes", async () => {
    await bothAccept(content, "base");
    await bothAccept({ name: "Empuje", stages: [] }, "no stages");
    await bothAccept(withStage({ name: "Solo el nombre", exercises: "" }), "name only");
    await bothAccept(withStage({ notes: "Solo notas", exercises: "" }), "notes only");
  });

  it("every exercise field on its own, and ordered rep ranges", async () => {
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
      await bothAccept(withLines(line), JSON.stringify(line));
    }
  }, 60_000);

  it("links to named sites: paths, queries, ports and a trailing dot", async () => {
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
      await bothAccept(withLines(lineWithLink(link)), link);
      await bothAccept(withLines(`a\t\t\t\t\thttps://x.com\n${lineWithLink(link)}`), link);
    }
  }, 120_000);

  it("the largest copy, multibyte text and texts starting with an emoji", async () => {
    const largest = toStoredRoutine({
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
          link: `https://x.com/${"e".repeat(L.linkLength - 14)}`,
        })),
      })),
    });
    await bothAccept(largest, "largest");
    const e = "\u{1F4AA}";
    await bothAccept(
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
      "multibyte",
    );
    for (const t of ["\u{1F4AA} Piernas", "\u{1FAE8} Core"]) {
      await bothAccept({ ...content, name: t }, `name ${t}`);
      await bothAccept({ ...content, notes: t }, `notes ${t}`);
      await bothAccept(withStage({ name: t, exercises: "Remo\t\t\t\t\t" }), `stage name ${t}`);
      await bothAccept(withStage({ notes: t, exercises: "Remo\t\t\t\t\t" }), `stage notes ${t}`);
      await bothAccept(withLines(`${t}\t\t\t\t\t`), `exercise name ${t}`);
      await bothAccept(withLines(`Remo\t\t\t\t${t}\t`), `exercise notes ${t}`);
    }
  }, 60_000);

  it("notes that look like a link, and limits at their edge", async () => {
    await bothAccept(withLines("Remo\t\t\t\thttps://router/x\thttps://youtu.be/abc"), "notes link");
    await bothAccept(withLines("https://localhost/x\t\t\t\t\t"), "name link");
    const line = "x\t\t\t\t\t";
    await bothAccept(
      withLines(Array.from({ length: L.exercisesPerStage }, () => line).join("\n")),
      "15 lines",
    );
    await bothAccept(
      { ...content, stages: Array.from({ length: L.stages }, () => ({ exercises: line })) },
      "10 stages",
    );
    await bothAccept({ ...content, name: "a".repeat(L.nameLength) }, "name 40");
    await bothAccept({ ...content, notes: "n".repeat(L.notesLength) }, "notes 500");
  }, 60_000);
});
