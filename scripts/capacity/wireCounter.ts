/**
 * Counts the Firestore document reads, writes and deletes one or more Firebase JS SDK clients send
 * and receive, by reading the SDK's own debug log of every gRPC message (T32). Node only: the
 * SDK's Node build talks gRPC and logs each message with util.inspect, which this parses.
 *
 * What counts, following Firestore's billing rules:
 * - read: a `documentChange` on a Listen stream that brings a listener a document, or a version of
 *   it, that this listener did not have yet (its initial results, a document added or changed, and
 *   getDocFromServer, which the SDK runs as a one-document listener), a `found` or `missing`
 *   result of BatchGetDocuments (transaction reads); and a listener target that becomes CURRENT
 *   with no document, which Firestore bills as one read (minimum charge per query). Those are
 *   counted apart as `emptyQueryReads`, as the emulator cannot confirm the charge.
 * - emulatorResends: the emulator answers any change to a listened query with a RESET and sends
 *   every document again, versions the listener already holds. Production sends only the
 *   documents that changed, so these are counted apart and are not reads.
 * - write: an `update` in a Write stream message or in a Commit (transaction) the server accepted
 *   (a set, update, or a batch's set; a serverTimestamp transform in the same write is not counted
 *   apart). A refused Commit, such as a transaction that lost a race, writes nothing.
 * - delete: a `delete` in a Write stream message or an accepted Commit.
 * - ruleReads (derived, not seen on the wire): each write the rules check with get/exists, as
 *   firestore/firestore.rules reads them: a contact create 1 get (isContact), an inbox copy create
 *   2 get + 1 exists (isInboxCopy). No other rule calls get or exists.
 */
import { onLog } from "firebase/app";
import { setLogLevel } from "firebase/firestore";

export interface Tally {
  reads: number;
  emptyQueryReads: number;
  emulatorResends: number;
  writes: number;
  deletes: number;
  ruleReads: number;
}

export interface PhaseResult {
  name: string;
  total: Tally;
  /** By where the document lives: `<role>/<collection>` or `directory`. */
  byPlace: Map<string, Tally>;
  /** Listener targets opened during the phase, by place (several onSnapshot on one query share one). */
  targetsOpened: Map<string, number>;
}

const emptyTally = (): Tally => ({
  reads: 0,
  emptyQueryReads: 0,
  emulatorResends: 0,
  writes: 0,
  deletes: 0,
  ruleReads: 0,
});

const DOC_NAME = /'(projects\/[^']+\/documents\/[^']+)'/;

interface Target {
  place: string;
  docs: number;
  current: boolean;
  /** The version (updateTime) of each document this listener was sent. */
  versions: Map<string, string>;
}

/**
 * Starts counting at once; `begin` names the phase the next events belong to, `end` returns it.
 * `roleOf` turns a uid into a short role name for the report.
 */
export function startWireCounter(roleOf: (uid: string) => string) {
  let phase: PhaseResult | null = null;
  let lastEventAt = Date.now();
  const targets = new Map<string, Target>();
  /** Commit requests waiting for their answer, by RPC id. */
  const commits = new Map<string, string>();
  const rawLines: string[] = [];
  const keepRaw = process.env.CAPACITY_RAW !== undefined;

  const placeOf = (name: string): string => {
    const path = name.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\/?/, "");
    const parts = path.split("/");
    if (parts[0] === "users" && parts[1] !== undefined) {
      return `${roleOf(parts[1])}/${parts[2] ?? "(user)"}`;
    }
    return parts[0] ?? "(root)";
  };

  const add = (place: string, key: keyof Tally, amount = 1) => {
    if (!phase) return;
    lastEventAt = Date.now();
    phase.total[key] += amount;
    const tally = phase.byPlace.get(place) ?? emptyTally();
    tally[key] += amount;
    phase.byPlace.set(place, tally);
  };

  const countWrites = (body: string) => {
    for (const match of body.matchAll(/\bupdate: \{\s*name: '(projects\/[^']+)'/g)) {
      const name = match[1] ?? "";
      const place = placeOf(name);
      add(place, "writes");
      if (/\/contacts\/[^/]+$/.test(name)) add(place, "ruleReads", 1);
      if (/\/inbox\/[^/]+$/.test(name)) add(place, "ruleReads", 3);
    }
    for (const match of body.matchAll(/\bdelete: '(projects\/[^']+)'/g)) {
      add(placeOf(match[1] ?? ""), "deletes");
    }
  };

  const onListenSent = (stream: string, body: string) => {
    const added = /addTarget: \{/.test(body);
    if (!added) return;
    const targetId = /targetId: (\d+)/.exec(body)?.[1];
    if (targetId === undefined) return;
    let place = "(unknown)";
    const parent = /parent: '(projects\/[^']+)'/.exec(body)?.[1];
    const collectionId = /collectionId: '([^']+)'/.exec(body)?.[1];
    if (parent !== undefined && collectionId !== undefined) {
      place = placeOf(`${parent}/${collectionId}`);
    } else {
      const name = DOC_NAME.exec(body)?.[1];
      if (name !== undefined) place = `${placeOf(name)} (one document)`;
    }
    targets.set(`${stream}:${targetId}`, { place, docs: 0, current: false, versions: new Map() });
    if (phase) {
      lastEventAt = Date.now();
      phase.targetsOpened.set(place, (phase.targetsOpened.get(place) ?? 0) + 1);
    }
  };

  const idsIn = (body: string, field: string): string[] => {
    const list = new RegExp(`${field}: \\[([^\\]]*)\\]`).exec(body)?.[1] ?? "";
    return list
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
  };

  const onListenReceived = (stream: string, body: string) => {
    if (/documentChange: \{/.test(body)) {
      const name = DOC_NAME.exec(body)?.[1] ?? "";
      const version = /updateTime: \{([^}]*)\}/.exec(body)?.[1] ?? "";
      let known = true;
      for (const id of idsIn(body, "targetIds")) {
        const target = targets.get(`${stream}:${id}`);
        if (!target) {
          known = false;
          continue;
        }
        target.docs += 1;
        if (target.versions.get(name) !== version) known = false;
        target.versions.set(name, version);
      }
      add(placeOf(name), known ? "emulatorResends" : "reads");
      return;
    }
    if (/targetChangeType: 'CURRENT'/.test(body)) {
      for (const id of idsIn(body, "targetIds")) {
        const target = targets.get(`${stream}:${id}`);
        if (!target || target.current) continue;
        target.current = true;
        if (target.docs === 0) add(target.place.replace(" (one document)", ""), "emptyQueryReads");
      }
    }
  };

  setLogLevel("debug");
  onLog(
    ({ message }) => {
      if (!message.includes("RPC")) return;
      if (keepRaw) rawLines.push(message);
      let match = /RPC 'Listen' stream (\S+) sending:([\s\S]*)$/.exec(message);
      if (match) return onListenSent(match[1] ?? "", match[2] ?? "");
      match = /RPC 'Listen' stream (\S+) received:([\s\S]*)$/.exec(message);
      if (match) return onListenReceived(match[1] ?? "", match[2] ?? "");
      match = /RPC 'Write' stream \S+ sending:([\s\S]*)$/.exec(message);
      if (match) return countWrites(match[1] ?? "");
      match = /RPC 'Commit' (\S+) invoked with request:([\s\S]*)$/.exec(message);
      if (match) {
        commits.set(match[1] ?? "", match[2] ?? "");
        return;
      }
      match = /RPC 'Commit' (\S+) (completed|failed)/.exec(message);
      if (match) {
        const id = match[1] ?? "";
        if (match[2] === "completed") countWrites(commits.get(id) ?? "");
        commits.delete(id);
        return;
      }
      match = /RPC BatchGetDocuments \S+ received result:([\s\S]*)$/.exec(message);
      if (match) {
        const body = match[1] ?? "";
        const name =
          /found: \{\s*name: '(projects\/[^']+)'/.exec(body)?.[1] ??
          /missing: '(projects\/[^']+)'/.exec(body)?.[1];
        if (name !== undefined) add(placeOf(name), "reads");
      }
    },
    { level: "debug" },
  );

  return {
    begin(name: string) {
      phase = { name, total: emptyTally(), byPlace: new Map(), targetsOpened: new Map() };
      lastEventAt = Date.now();
    },
    end(): PhaseResult {
      if (!phase) throw new Error("No phase running");
      const done = phase;
      phase = null;
      return done;
    },
    /** Resolves once nothing was counted for `quietMs`, or after `maxMs`. */
    async settle(quietMs = 1500, maxMs = 20_000) {
      const started = Date.now();
      lastEventAt = Math.max(lastEventAt, started);
      while (Date.now() - lastEventAt < quietMs && Date.now() - started < maxMs) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    rawLines,
    stop() {
      onLog(null);
      setLogLevel("error");
    },
  };
}
