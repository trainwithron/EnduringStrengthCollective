import { describe, it, expect } from "vitest";
import { addPending, dueNotices, expiredNotices, listPending, removePending, NOTICE_MAX_AGE_MS, type KeyValueStore } from "./pending-booking-notices";

function memoryStore(initial?: string): KeyValueStore & { raw: () => string | null } {
  let value: string | null = initial ?? null;
  return { getItem: () => value, setItem: (_k, v) => (value = v), raw: () => value };
}
const n = (id: string, madeAt: number) => ({ bookingId: id, athleteId: "a", groupId: "g", startIso: "2026-10-15T15:00:00.000Z", madeAt });

describe("announcements waiting out their undo time", () => {
  it("are written down, found again, and removed", () => {
    const s = memoryStore();
    addPending(n("b1", 1000), s);
    addPending(n("b2", 2000), s);
    expect(listPending(s).map((x) => x.bookingId)).toEqual(["b1", "b2"]);
    removePending("b1", s);
    expect(listPending(s).map((x) => x.bookingId)).toEqual(["b2"]);
  });
  it("one booking is never written twice", () => {
    const s = memoryStore();
    addPending(n("b1", 1000), s);
    addPending(n("b1", 5000), s);
    expect(listPending(s)).toHaveLength(1);
    expect(listPending(s)[0].madeAt).toBe(5000);
  });
  it("only the ones past their undo window are due", () => {
    const list = [n("old", 0), n("fresh", 9000)];
    expect(dueNotices(list, 10000, 8000).map((x) => x.bookingId)).toEqual(["old"]);
    expect(dueNotices(list, 10000, 0)).toHaveLength(2);
  });
  it("very old ones are dropped instead of announced late", () => {
    const now = NOTICE_MAX_AGE_MS + 1000;
    expect(expiredNotices([n("a", 0), n("b", now - 1000)], now).map((x) => x.bookingId)).toEqual(["a"]);
  });
  it("a missing, broken or foreign store never throws", () => {
    expect(listPending(null)).toEqual([]);
    expect(listPending(memoryStore("not json"))).toEqual([]);
    expect(listPending(memoryStore('{"a":1}'))).toEqual([]);
    expect(listPending(memoryStore('[{"bookingId":1}]'))).toEqual([]);
    expect(() => addPending(n("b", 1), null)).not.toThrow();
    expect(() => removePending("b", null)).not.toThrow();
  });
  it("keeps the list short", () => {
    const s = memoryStore();
    for (let i = 0; i < 80; i++) addPending(n(`b${i}`, i), s);
    expect(listPending(s).length).toBe(50);
    expect(listPending(s)[49].bookingId).toBe("b79");
  });
});
