import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OutboxStore } from "../../shared/application/outbox";
import { ContactRefused, type Contact } from "../domain/contact";
import { createFirestoreContactList } from "./firestoreContactList";

const firestore = vi.hoisted(() => ({
  /** Directory entries on the server, by path. */
  directory: new Map<string, Record<string, unknown>>(),
  /** The account's contacts as Firestore reports them, by id. */
  contacts: new Map<string, object>(),
  /** Paths whose document this device's cache holds. */
  cached: new Set<string>(),
  serverReachable: true,
  /** How setDoc and deleteDoc answer; at once by default. */
  answer: () => Promise.resolve(),
  /** What happened, in order. */
  calls: [] as string[],
  listeners: new Set<() => void>(),
}));

const report = () => {
  firestore.listeners.forEach((listener) => {
    listener();
  });
};

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  doc: (parent: { path?: string }, ...segments: string[]) => ({
    path: [...(parent.path ? [parent.path] : []), ...segments].join("/"),
  }),
  getDocFromServer: ({ path }: { path: string }) => {
    firestore.calls.push(`serverRead ${path}`);
    if (!firestore.serverReachable) {
      return Promise.reject(Object.assign(new Error("offline"), { code: "unavailable" }));
    }
    const data = firestore.directory.get(path);
    return Promise.resolve({ exists: () => data !== undefined, data: () => data });
  },
  getDocFromCache: ({ path }: { path: string }) => {
    firestore.calls.push(`cacheRead ${path}`);
    return Promise.resolve({ exists: () => firestore.cached.has(path) });
  },
  onSnapshot: (_query: unknown, onNext: (snapshot: unknown) => void) => {
    const listener = () => {
      onNext({
        docs: [...firestore.contacts].map(([id, data]) => ({ id, data: () => data })),
      });
    };
    firestore.listeners.add(listener);
    listener();
    return () => firestore.listeners.delete(listener);
  },
  setDoc: ({ path }: { path: string }, data: object) => {
    firestore.calls.push(`setDoc ${path}`);
    firestore.cached.add(path);
    firestore.contacts.set(path.split("/").at(-1) ?? "", data);
    report();
    return firestore.answer();
  },
  deleteDoc: ({ path }: { path: string }) => {
    firestore.calls.push(`deleteDoc ${path}`);
    firestore.cached.delete(path);
    firestore.contacts.delete(path.split("/").at(-1) ?? "");
    report();
    return firestore.answer();
  },
}));

const bobEntry = {
  uid: "bob",
  name: "Bob Stone",
  photo: "https://lh3.googleusercontent.com/a/bob=s96-c",
};
const bob: Contact = { ...bobEntry, email: "bob@example.com" };

type Guard = <T>(write: () => Promise<T>) => Promise<T>;

function setup({ guard }: { guard?: Guard } = {}) {
  let items: { id: string; draft: Contact }[] = [];
  const store: OutboxStore<Contact> = {
    load: () => items,
    save(next) {
      items = next;
    },
  };
  const contacts = createFirestoreContactList({} as never, "u1", {
    store,
    whenReady: () => Promise.resolve(true),
    guard,
  });
  return { contacts, store };
}

function recordingGuard(): Guard {
  return async (write) => {
    firestore.calls.push("lock");
    const result = await write();
    firestore.calls.push("unlock");
    return result;
  };
}

const refusalOf = async (attempt: Promise<unknown>) => {
  const error: unknown = await attempt.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ContactRefused);
  return (error as ContactRefused).kind;
};

const writes = () => firestore.calls.filter((call) => /^(setDoc|deleteDoc)/.test(call));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createFirestoreContactList", () => {
  beforeEach(() => {
    firestore.directory.clear();
    firestore.contacts.clear();
    firestore.cached.clear();
    firestore.listeners.clear();
    firestore.calls.length = 0;
    firestore.serverReachable = true;
    firestore.answer = () => Promise.resolve();
    firestore.directory.set("directory/bob@example.com", bobEntry);
  });

  it("adds by email: reads the directory from the server and stores the contact under its uid", async () => {
    const { contacts } = setup();
    const added = await contacts.add("  Bob@Example.COM ");
    expect(added.contact).toEqual(bob);
    await expect(added.saved).resolves.toBeUndefined();
    expect(firestore.calls[0]).toBe("serverRead directory/bob@example.com");
    expect(firestore.contacts.get("bob")).toEqual(bob);
    expect(writes()).toEqual(["setDoc users/u1/contacts/bob"]);
  });

  it("keeps only a Google photo and a clean name", async () => {
    firestore.directory.set("directory/bob@example.com", {
      uid: "bob",
      name: "Bob\u0000\ud800 Stone",
      photo: "https://evil.com/bob.png",
    });
    const { contacts } = setup();
    await (
      await contacts.add("bob@example.com")
    ).saved;
    expect(firestore.contacts.get("bob")).toEqual({ ...bob, name: "Bob Stone", photo: "" });
  });

  it("refuses an email that is not one, without asking the server", async () => {
    const { contacts } = setup();
    for (const email of ["", "   ", "bob", "bob@example.com/x", "a b@example.com"]) {
      expect(await refusalOf(contacts.add(email))).toBe("invalidEmail");
    }
    expect(firestore.calls).toEqual([]);
  });

  it("refuses, writing nothing, when the server cannot be asked", async () => {
    firestore.serverReachable = false;
    const { contacts, store } = setup();
    expect(await refusalOf(contacts.add("bob@example.com"))).toBe("offline");
    expect(writes()).toEqual([]);
    expect(store.load()).toEqual([]);
  });

  it("refuses an email nobody listed in the directory", async () => {
    const { contacts } = setup();
    expect(await refusalOf(contacts.add("carol@example.com"))).toBe("notListed");
    expect(writes()).toEqual([]);
  });

  it("refuses an entry it cannot use", async () => {
    firestore.directory.set("directory/carol@example.com", { name: "Carol" });
    const { contacts } = setup();
    expect(await refusalOf(contacts.add("carol@example.com"))).toBe("notListed");
    expect(writes()).toEqual([]);
  });

  it("refuses adding yourself", async () => {
    firestore.directory.set("directory/me@example.com", { uid: "u1", name: "Me", photo: "" });
    const { contacts } = setup();
    expect(await refusalOf(contacts.add("me@example.com"))).toBe("self");
    expect(writes()).toEqual([]);
  });

  it("refuses someone already saved, even under another email", async () => {
    firestore.contacts.set("bob", { ...bob, email: "bob@old.example.com" });
    const { contacts } = setup();
    expect(await refusalOf(contacts.add("bob@example.com"))).toBe("duplicate");
    expect(writes()).toEqual([]);
  });

  it("refuses a 51st contact", async () => {
    for (let index = 0; index < 50; index += 1) {
      firestore.contacts.set(`u${index + 2}`, {
        uid: `u${index + 2}`,
        name: "",
        photo: "",
        email: `u${index + 2}@example.com`,
      });
    }
    const { contacts } = setup();
    expect(await refusalOf(contacts.add("bob@example.com"))).toBe("full");
    expect(writes()).toEqual([]);
  });

  it("counts an add still on its way, so two at once never pass the checks twice", async () => {
    firestore.answer = () => new Promise(() => undefined);
    const { contacts } = setup();
    const first = contacts.add("bob@example.com");
    const second = contacts.add("bob@example.com");
    await first;
    expect(await refusalOf(second)).toBe("duplicate");
    expect(writes()).toEqual(["setDoc users/u1/contacts/bob"]);
  });

  it("adds while holding the account's lock until Firestore's cache has it, not the server's answer", async () => {
    firestore.answer = () => new Promise(() => undefined);
    const { contacts, store } = setup({ guard: recordingGuard() });
    const added = await contacts.add("bob@example.com");
    expect(added.contact).toEqual(bob);
    const unlock = firestore.calls.indexOf("unlock");
    expect(firestore.calls.indexOf("lock")).toBeLessThan(
      firestore.calls.indexOf("setDoc users/u1/contacts/bob"),
    );
    expect(unlock).toBeGreaterThan(firestore.calls.indexOf("setDoc users/u1/contacts/bob"));
    expect(store.load()).toEqual([]);
  });

  it("writes nothing when the lock refuses, and passes the refusal on", async () => {
    const refusal = new Error("signed out in another tab");
    const { contacts, store } = setup({ guard: () => Promise.reject(refusal) });
    await expect(contacts.add("bob@example.com")).rejects.toBe(refusal);
    await expect(contacts.remove("bob")).rejects.toBe(refusal);
    expect(writes()).toEqual([]);
    expect(store.load()).toEqual([]);
  });

  it("passes on the server's refusal of the write in saved", async () => {
    const denied = Object.assign(new Error("denied"), { code: "permission-denied" });
    firestore.answer = () => Promise.reject(denied);
    const { contacts } = setup();
    const added = await contacts.add("bob@example.com");
    await expect(added.saved).rejects.toBe(denied);
  });

  it("removes a contact, settling when the server answers", async () => {
    firestore.contacts.set("bob", bob);
    firestore.cached.add("users/u1/contacts/bob");
    const { contacts } = setup({ guard: recordingGuard() });
    await expect(contacts.remove("bob")).resolves.toBeUndefined();
    expect(firestore.calls).toEqual([
      "lock",
      "deleteDoc users/u1/contacts/bob",
      "cacheRead users/u1/contacts/bob",
      "unlock",
    ]);
    expect(firestore.contacts.has("bob")).toBe(false);
  });

  it("lists contacts by name, leaving out any it cannot read", async () => {
    firestore.contacts.set("bob", bob);
    firestore.contacts.set("ana", { uid: "ana", name: "Ana", photo: "", email: "ana@example.com" });
    firestore.contacts.set("bad", { uid: "other", name: "X", photo: "", email: "x@example.com" });
    const { contacts } = setup();
    const seen: Contact[][] = [];
    const stop = contacts.subscribe(
      (items) => seen.push(items),
      () => undefined,
    );
    await settle();
    stop();
    expect(seen.at(-1)?.map(({ uid }) => uid)).toEqual(["ana", "bob"]);
  });
});
