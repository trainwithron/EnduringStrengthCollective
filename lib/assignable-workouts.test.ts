import { describe, it, expect } from "vitest";
import { filterAssignableWorkouts } from "@/lib/assignable-workouts";

const w = (id: string, programs: any) => ({ id, title: "Day", week_number: 1, day_index: 0, programs });

describe("workouts a coach may put on a client's day", () => {
  const rows = [
    w("own", { name: "Mine", ai_draft: false, archived_at: null, athlete_id: "a" }),
    w("shared", { name: "Team", ai_draft: false, archived_at: null, athlete_id: null }),
    w("draft", { name: "Draft", ai_draft: true, archived_at: null, athlete_id: "a" }),
    w("removed", { name: "Gone", ai_draft: false, archived_at: "2026-10-01", athlete_id: "a" }),
    w("other", { name: "Bea", ai_draft: false, archived_at: null, athlete_id: "b" }),
    w("orphan", null),
  ];
  it("offers the client's own and shared workouts in a group", () => {
    expect(filterAssignableWorkouts(rows as any, "a", false).map((o) => o.id)).toEqual(["own", "shared"]);
  });
  it("in a one-on-one space a no-client program is the coach's hidden template and is not offered", () => {
    expect(filterAssignableWorkouts(rows as any, "a", true).map((o) => o.id)).toEqual(["own"]);
  });
  it("never offers an unsigned AI draft, a removed program or another client's program", () => {
    const ids = filterAssignableWorkouts(rows as any, "a", false).map((o) => o.id);
    for (const bad of ["draft", "removed", "other", "orphan"]) expect(ids).not.toContain(bad);
  });
});
