import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { onlyOpenSlots, withBusy } from "@/lib/coach-busy";

const read = (p: string) => readFileSync(p, "utf8");
const at = (h: number) => new Date(Date.UTC(2026, 10, 5, h));
const slot = (h: number) => ({ start: at(h), durationMinutes: 60 });

describe("client day page offers only the open times (Ron, Nov 3)", () => {
  const busy = [{ id: "other", start: at(14), end: at(15) }, { id: "mine", start: at(17), end: at(18) }];
  it("drops a time another client has, keeps the client's own session and the free times", () => {
    const out = onlyOpenSlots([slot(13), slot(14), slot(15), slot(17)], busy, new Set([at(17).getTime()]), null, 0).map((s) => s.start.getUTCHours());
    expect(out).toEqual([13, 15, 17]);
  });
  it("drops a time too close to another session when the coach has a buffer", () => {
    const out = onlyOpenSlots([slot(12), slot(13), slot(15)], busy, new Set(), null, 15).map((s) => s.start.getUTCHours());
    expect(out).toEqual([12]);
  });
  it("the session being moved does not block its own time", () => {
    const out = onlyOpenSlots([slot(17)], busy, new Set(), "mine", 0).map((s) => s.start.getUTCHours());
    expect(out).toEqual([17]);
  });
  it("merges without listing a session twice", () => {
    expect(withBusy([{ id: "mine", start: at(17), end: at(18) }], busy).map((b) => b.id)).toEqual(["mine", "other"]);
  });
  it("both client day pages use it", () => {
    for (const f of ["app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      const src = read(f);
      expect(src).toContain("coachBusyRanges(coachMembership.profile_id, zonedDayStart.toISOString(), zonedDayEnd.toISOString())");
      expect(src).toContain("slots = onlyOpenSlots(");
    }
  });
});
