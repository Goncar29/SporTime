// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import type { Routine } from "./routine";
import { receivedIds, unseenReceived } from "./newRoutines";

const sender = { uid: "alice", name: "Alice", email: "alice@example.com" };
const own = (id: string): Routine => ({ id, name: id, createdAt: 1, stages: [] });
const received = (id: string): Routine => ({ ...own(id), receivedFrom: sender });

describe("new received routines (T27, S7)", () => {
  it("are the received routines not yet seen; one's own never count", () => {
    const routines = [own("o1"), received("r1"), received("r2"), received("r3")];
    expect(unseenReceived(routines, new Set(["r2"]))).toEqual(["r1", "r3"]);
    expect(unseenReceived(routines, new Set(["r1", "r2", "r3"]))).toEqual([]);
    expect(unseenReceived([own("o1")], new Set())).toEqual([]);
  });

  it("are all seen once the list is seen: the ids kept are those of the received routines now", () => {
    expect(receivedIds([own("o1"), received("r1"), received("r2")])).toEqual(["r1", "r2"]);
    // A routine deleted since is no longer kept.
    expect(receivedIds([])).toEqual([]);
  });
});
