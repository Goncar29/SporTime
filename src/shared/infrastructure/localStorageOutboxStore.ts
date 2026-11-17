import type { OutboxStore, Pending } from "../application/outbox";

function isPending(value: unknown): value is Pending<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    "draft" in value
  );
}

function parse(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return null;
  }
}

/**
 * Tabs of one browser share this storage and can read it a moment late, so every write sits
 * under its own key: a tab adding, editing or dropping one never rewrites another's. The key
 * given holds the whole list as earlier versions stored it, which is still read. Every key of
 * the store starts like the key given and ends with its last segment, the account's id.
 * Blocked storage only costs surviving a reload: this page still keeps what it holds.
 */
export function createLocalStorageOutboxStore<Draft>(key: string): OutboxStore<Draft> {
  let fallback: Pending<Draft>[] | null = null;
  const lastDot = key.lastIndexOf(".");
  const head = `${lastDot < 0 ? key : key.slice(0, lastDot)}#`;
  const tail = lastDot < 0 ? "" : key.slice(lastDot);
  const itemKey = (id: string) => `${head}${id}${tail}`;

  const list = (): Pending<Draft>[] => {
    const parsed = parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? (parsed.filter(isPending) as Pending<Draft>[]) : [];
  };

  const itemKeys = () =>
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? "").filter(
      (name) => name.startsWith(head) && name.endsWith(tail),
    );

  const items = (): Pending<Draft>[] => {
    const byId = new Map(list().map((item) => [item.id, item]));
    itemKeys().forEach((name) => {
      const value = parse(localStorage.getItem(name));
      if (isPending(value) && itemKey(value.id) === name)
        byId.set(value.id, value as Pending<Draft>);
    });
    return [...byId.values()];
  };

  const save = (next: Pending<Draft>[]) => {
    try {
      itemKeys().forEach((name) => {
        localStorage.removeItem(name);
      });
      if (next.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(next));
      fallback = null;
    } catch {
      fallback = next;
    }
  };

  const load = () => {
    if (fallback) return fallback;
    try {
      return items();
    } catch {
      return [];
    }
  };

  return {
    load,
    save,
    put(item) {
      if (fallback) {
        save([...fallback.filter(({ id }) => id !== item.id), item]);
        return;
      }
      try {
        localStorage.setItem(itemKey(item.id), JSON.stringify(item));
      } catch {
        fallback = [...load().filter(({ id }) => id !== item.id), item];
      }
    },
    remove(id) {
      if (fallback) {
        save(fallback.filter((item) => item.id !== id));
        return;
      }
      try {
        localStorage.removeItem(itemKey(id));
        // Only what an earlier version stored is rewritten as a whole.
        const stored = list();
        if (!stored.some((item) => item.id === id)) return;
        const rest = stored.filter((item) => item.id !== id);
        if (rest.length === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(rest));
      } catch {
        fallback = load().filter((item) => item.id !== id);
      }
    },
  };
}
