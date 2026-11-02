import type { OutboxStore, Pending } from "../application/outbox";

function isPending(value: unknown): value is Pending<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    "draft" in value
  );
}

/** Blocked storage only costs surviving a reload: this page still keeps what it holds. */
export function createLocalStorageOutboxStore<Draft>(key: string): OutboxStore<Draft> {
  let fallback: Pending<Draft>[] | null = null;

  return {
    load() {
      if (fallback) return fallback;
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
        return Array.isArray(parsed) ? (parsed.filter(isPending) as Pending<Draft>[]) : [];
      } catch {
        return [];
      }
    },
    save(items) {
      try {
        if (items.length === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(items));
        fallback = null;
      } catch {
        fallback = items;
      }
    },
  };
}
