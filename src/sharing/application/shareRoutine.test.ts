// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Contact } from "../../contacts/domain/contact";
import type { RoutineDraft } from "../../routines/domain/routine";
import type { SenderClaims, SharedCopy } from "../domain/sharedCopy";
import type { InboxWriter, Preparation, Share } from "./ports";
import { createRoutineSharing } from "./shareRoutine";

const contact = (uid: string, name: string): Contact => ({
  uid,
  name,
  photo: "",
  email: `${uid}@example.com`,
});
const bob = contact("bob", "Bob");
const carol = contact("carol", "Carol");
const dave = contact("dave", "Dave");

const alice: SenderClaims = {
  uid: "alice",
  email: "alice@example.com",
  emailVerified: true,
  name: "Alice",
};

const piernas: RoutineDraft = {
  name: "Piernas",
  createdAt: 1,
  stages: [{ name: "A", exercises: [{ name: "Sentadilla", repsMin: 8, repsMax: 10 }] }],
};

const failure = (code: string) => Object.assign(new Error(code), { code });

/**
 * What the server does with one write:
 * - `accept`: stores it and answers;
 * - `lose`: stores it, but the answer never arrives (the connection drops);
 * - `drop`: the connection drops before it arrives, so nothing is stored;
 * - `deny`: the rules refuse it;
 * - any other string: refuses with that code.
 * Like the rules, it refuses a copy id that is already stored (no update).
 */
type Answer = "accept" | "lose" | "drop" | "deny" | (string & {});

function serverInbox() {
  const stored = new Map<string, SharedCopy>();
  const writes: { recipient: string; id: string; copy: SharedCopy }[] = [];
  const plans = new Map<string, Answer[]>();
  const inbox: InboxWriter = {
    create(recipient, id, copy) {
      writes.push({ recipient, id, copy });
      const key = `${recipient}/${id}`;
      const answer = plans.get(recipient)?.shift() ?? "accept";
      if (stored.has(key) || answer === "deny") {
        return Promise.reject(failure("permission-denied"));
      }
      if (answer === "accept" || answer === "lose") stored.set(key, copy);
      if (answer === "accept") return Promise.resolve();
      if (answer === "lose" || answer === "drop") return Promise.reject(failure("unavailable"));
      return Promise.reject(failure(answer));
    },
  };
  return {
    inbox,
    stored,
    writes,
    /** The answers to the next writes to `recipient`, in order; `accept` once they run out. */
    plan(recipient: string, ...answers: Answer[]) {
      plans.set(recipient, answers);
    },
    copiesFor: (recipient: string) =>
      [...stored.keys()].filter((key) => key.startsWith(`${recipient}/`)).length,
  };
}

function setup({
  claims = () => Promise.resolve(alice),
  online = true,
  answerWithinMs,
}: {
  claims?: () => Promise<SenderClaims>;
  online?: boolean;
  answerWithinMs?: number;
} = {}) {
  const server = serverInbox();
  let ids = 0;
  const connection = { online };
  const identity = { claims: vi.fn(claims) };
  const sharing = createRoutineSharing({
    identity,
    inbox: server.inbox,
    online: () => connection.online,
    newCopyId: () => `copy-${++ids}`,
    answerWithinMs,
  });
  return { sharing, server, connection, identity };
}

function ready(preparation: Preparation): Share {
  if (preparation.kind !== "ready") throw new Error(`Not ready: ${preparation.kind}`);
  return preparation.share;
}

const outcomes = (deliveries: { contact: Contact; outcome: string }[]) =>
  deliveries.map(({ contact: { uid }, outcome }) => [uid, outcome]);

describe("sending a routine to contacts (T25, S12, S7)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes one copy per recipient, with the sender from the sign-in", async () => {
    const { sharing, server } = setup();
    const share = ready(await sharing.prepare(piernas, [bob, carol]));
    expect(outcomes(await share.send())).toEqual([
      ["bob", "sent"],
      ["carol", "sent"],
    ]);
    expect(server.writes.map(({ recipient, id }) => [recipient, id])).toEqual([
      ["bob", "copy-1"],
      ["carol", "copy-2"],
    ]);
    expect(server.writes[0]?.copy).toEqual({
      fromUid: "alice",
      fromEmail: "alice@example.com",
      fromName: "Alice",
      name: "Piernas",
      stages: [{ name: "A", exercises: "Sentadilla\t8-10\t\t\t\t" }],
    });
  });

  it("gives each recipient their own result: one refusal does not stop the others", async () => {
    const { sharing, server } = setup();
    server.plan("carol", "deny");
    server.plan("dave", "lose");
    const share = ready(await sharing.prepare(piernas, [bob, carol, dave]));
    expect(outcomes(await share.send())).toEqual([
      ["bob", "sent"],
      ["carol", "refused"],
      ["dave", "mayHaveArrived"],
    ]);
    expect([server.copiesFor("bob"), server.copiesFor("carol"), server.copiesFor("dave")]).toEqual([
      1, 0, 1,
    ]);
  });

  it("refuses an invalid routine before writing anything, naming what to fix", async () => {
    const { sharing, server } = setup();
    expect(await sharing.prepare({ ...piernas, name: "\u200bPiernas" }, [bob, carol])).toEqual({
      kind: "refused",
      problems: [{ kind: "routineName" }],
    });
    expect(
      await sharing.prepare(
        {
          ...piernas,
          stages: [{ exercises: [{ name: "Video", link: "https://x_y.com" }] }],
        },
        [bob],
      ),
    ).toEqual({
      kind: "refused",
      problems: [{ kind: "exercise", field: "link", stage: 1, exercise: 1, exerciseName: "Video" }],
    });
    expect(server.writes).toEqual([]);
  });

  it("refuses before writing when the sender's Google name breaks the rules", async () => {
    const { sharing, server } = setup({
      claims: () => Promise.resolve({ ...alice, name: "N".repeat(101) }),
    });
    expect(await sharing.prepare(piernas, [bob])).toEqual({
      kind: "refused",
      problems: [{ kind: "senderName" }],
    });
    expect(server.writes).toEqual([]);
  });

  it("converts an international link host in the copy only", async () => {
    const { sharing, server } = setup();
    const routine: RoutineDraft = {
      ...piernas,
      stages: [{ exercises: [{ name: "Libro", link: "https://bücher.de/libro" }] }],
    };
    await ready(await sharing.prepare(routine, [bob])).send();
    expect(server.writes[0]?.copy.stages[0]?.exercises).toBe(
      "Libro\t\t\t\t\thttps://xn--bcher-kva.de/libro",
    );
    expect(routine.stages[0]?.exercises[0]?.link).toBe("https://bücher.de/libro");
  });

  describe("a lost answer (L56 A4)", () => {
    it("is reported as may have arrived, never as failed", async () => {
      const { sharing, server } = setup();
      server.plan("bob", "lose");
      const share = ready(await sharing.prepare(piernas, [bob]));
      expect(outcomes(await share.send())).toEqual([["bob", "mayHaveArrived"]]);
    });

    it("is retried with the same copy id, which never delivers it twice", async () => {
      const { sharing, server } = setup();
      server.plan("bob", "lose");
      const share = ready(await sharing.prepare(piernas, [bob]));
      await share.send();
      // The first write arrived, so the rules refuse the second (no update): it may have arrived.
      expect(outcomes(await share.send())).toEqual([["bob", "mayHaveArrived"]]);
      expect(server.writes.map(({ id }) => id)).toEqual(["copy-1", "copy-1"]);
      expect(server.copiesFor("bob")).toBe(1);
    });

    it("is sent by the retry when the first write never arrived", async () => {
      const { sharing, server } = setup();
      server.plan("bob", "drop");
      const share = ready(await sharing.prepare(piernas, [bob]));
      expect(outcomes(await share.send())).toEqual([["bob", "mayHaveArrived"]]);
      expect(outcomes(await share.send())).toEqual([["bob", "sent"]]);
      expect(server.writes.map(({ id }) => id)).toEqual(["copy-1", "copy-1"]);
      expect(server.copiesFor("bob")).toBe(1);
    });

    it("is what an answer that takes too long becomes", async () => {
      vi.useFakeTimers();
      const never: InboxWriter = { create: () => new Promise(() => undefined) };
      const slow = createRoutineSharing({
        identity: { claims: () => Promise.resolve(alice) },
        inbox: never,
        online: () => true,
        newCopyId: () => "slow",
        answerWithinMs: 1_000,
      });
      const sending = ready(await slow.prepare(piernas, [bob])).send();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(outcomes(await sending)).toEqual([["bob", "mayHaveArrived"]]);
    });
  });

  it("only retries recipients not reached yet, each with their own copy id", async () => {
    const { sharing, server } = setup();
    server.plan("carol", "drop");
    const share = ready(await sharing.prepare(piernas, [bob, carol]));
    await share.send();
    expect(outcomes(await share.send())).toEqual([
      ["bob", "sent"],
      ["carol", "sent"],
    ]);
    expect(server.writes.map(({ recipient, id }) => [recipient, id])).toEqual([
      ["bob", "copy-1"],
      ["carol", "copy-2"],
      ["carol", "copy-2"],
    ]);
  });

  it("keeps a refusal a refusal when the first write was refused too", async () => {
    const { sharing, server } = setup();
    server.plan("carol", "deny", "deny");
    const share = ready(await sharing.prepare(piernas, [carol]));
    expect(outcomes(await share.send())).toEqual([["carol", "refused"]]);
    expect(outcomes(await share.send())).toEqual([["carol", "refused"]]);
  });

  it("gives a new confirmation new copy ids, so sending again delivers another copy", async () => {
    const { sharing, server } = setup();
    await ready(await sharing.prepare(piernas, [bob])).send();
    await ready(await sharing.prepare(piernas, [bob])).send();
    expect(server.writes.map(({ id }) => id)).toEqual(["copy-1", "copy-2"]);
    expect(server.copiesFor("bob")).toBe(2);
  });

  it("says when nothing was stored, and why", async () => {
    const { sharing, server } = setup();
    server.plan("bob", "resource-exhausted");
    server.plan("carol", "unauthenticated");
    const share = ready(await sharing.prepare(piernas, [bob, carol]));
    expect(await share.send()).toEqual([
      { contact: bob, outcome: "failed", failure: "busy" },
      { contact: carol, outcome: "failed", failure: "sessionEnded" },
    ]);
  });

  describe("without a connection (L58)", () => {
    it("prepares nothing and reads no sign-in when offline", async () => {
      const { sharing, server, identity } = setup({ online: false });
      expect(await sharing.prepare(piernas, [bob])).toEqual({ kind: "offline" });
      expect(identity.claims).not.toHaveBeenCalled();
      expect(server.writes).toEqual([]);
    });

    it("says the sign-in could not be read offline", async () => {
      const { sharing } = setup({ claims: () => Promise.reject(failure("unavailable")) });
      expect(await sharing.prepare(piernas, [bob])).toEqual({ kind: "offline" });
      const signedOut = setup({ claims: () => Promise.reject(failure("unauthenticated")) });
      expect(await signedOut.sharing.prepare(piernas, [bob])).toEqual({
        kind: "failed",
        failure: "sessionEnded",
      });
    });

    it("writes nothing when the connection goes before sending, and sends once it is back", async () => {
      const { sharing, server, connection } = setup();
      const share = ready(await sharing.prepare(piernas, [bob, carol]));
      connection.online = false;
      expect(outcomes(await share.send())).toEqual([
        ["bob", "offline"],
        ["carol", "offline"],
      ]);
      expect(server.writes).toEqual([]);
      connection.online = true;
      expect(outcomes(await share.send())).toEqual([
        ["bob", "sent"],
        ["carol", "sent"],
      ]);
    });
  });

  it("never sends twice when asked again while sending", async () => {
    let answer: () => void = () => undefined;
    const creates: string[] = [];
    const held: InboxWriter = {
      create(recipient) {
        creates.push(recipient);
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      },
    };
    const sharing = createRoutineSharing({
      identity: { claims: () => Promise.resolve(alice) },
      inbox: held,
      online: () => true,
      newCopyId: () => "id",
    });
    const share = ready(await sharing.prepare(piernas, [bob]));
    const first = share.send();
    const second = share.send();
    expect(second).toBe(first);
    answer();
    expect(outcomes(await first)).toEqual([["bob", "sent"]]);
    expect(creates).toEqual(["bob"]);
    // Once it settled, a sent copy is not sent again.
    expect(outcomes(await share.send())).toEqual([["bob", "sent"]]);
    expect(creates).toEqual(["bob"]);
  });
});
