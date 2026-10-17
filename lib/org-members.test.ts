import { describe, it, expect } from "vitest";
import { readStayingMembers } from "./org-members";

describe("readStayingMembers", () => {
  it("filters leaving coaches out, and repeats the read without the filter when the column is missing", async () => {
    const calls: boolean[] = [];
    const ok = await readStayingMembers(async (x) => (calls.push(x), { data: [{ id: 1 }], error: null }));
    expect(ok.data).toEqual([{ id: 1 }]);
    expect(calls).toEqual([true]);
    calls.length = 0;
    const retried = await readStayingMembers(async (x) => (calls.push(x), x ? { data: null, error: { message: "column departing_since does not exist" } } : { data: [{ id: 2 }], error: null }));
    expect(retried.data).toEqual([{ id: 2 }]);
    expect(calls).toEqual([true, false]);
  });
  it("a read that fails both ways still reports the error", async () => {
    const r = await readStayingMembers(async () => ({ data: null, error: { message: "down" } }));
    expect(r.error?.message).toBe("down");
  });
});
