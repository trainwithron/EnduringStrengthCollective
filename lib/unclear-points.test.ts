import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMPORT_BASELINE_NOTE,
  IMPORT_UNITS_NOTE,
  UNCLEAR_COUNTED_LABEL,
  UNCLEAR_LABEL,
  fixUnclearPoint,
  flagUnclearSets,
  listUnclearPoints,
  setUnclearPointCounted,
  unclearFoundLine,
  unclearLabel,
} from "@/lib/unclear-points";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// A small stand-in for the database client: records the calls and answers with what the test hands it.
function fake(opts: { rows?: any[]; rpc?: Record<string, { data?: any; error?: any }>; updateRows?: any[]; updateError?: any }) {
  const calls: { rpc: [string, any][]; updates: any[] } = { rpc: [], updates: [] };
  const query: any = {
    select: () => query,
    eq: () => query,
    not: () => query,
    limit: () => Promise.resolve({ data: opts.rows ?? [], error: null }),
    update: (patch: any) => {
      calls.updates.push(patch);
      return { eq: () => ({ select: () => Promise.resolve({ data: opts.updateRows ?? [{ id: "s1" }], error: opts.updateError ?? null }) }) };
    },
  };
  const client: any = {
    from: () => query,
    rpc: (name: string, args: any) => {
      calls.rpc.push([name, args]);
      return Promise.resolve(opts.rpc?.[name] ?? { data: null, error: null });
    },
  };
  return { client, calls };
}

describe("unclear data points", () => {
  it("the plain words", () => {
    expect(UNCLEAR_LABEL).toBe("Unclear data point (not counted)");
    expect(unclearLabel("unclear")).toBe(UNCLEAR_LABEL);
    expect(unclearLabel("accepted")).toBe(UNCLEAR_COUNTED_LABEL);
    expect(unclearLabel(null)).toBeNull();
    expect(IMPORT_BASELINE_NOTE).toContain("baseline");
    expect(IMPORT_UNITS_NOTE).toBe("Imports are read as pounds.");
  });

  it("the import report: nothing for none, singular and plural", () => {
    expect(unclearFoundLine(0)).toBe("");
    expect(unclearFoundLine(1)).toBe("1 unclear data point found. It is kept as entered and not counted; review it on this page.");
    expect(unclearFoundLine(3)).toBe("3 unclear data points found. They are kept as entered and not counted; review them on this page.");
  });

  it("the check reports how many it newly marked, and 0 when it could not run", async () => {
    const ok = fake({ rpc: { flag_unclear_sets: { data: 4 } } });
    expect(await flagUnclearSets(ok.client, "g", "a")).toBe(4);
    expect(ok.calls.rpc[0]).toEqual(["flag_unclear_sets", { p_athlete: "a", p_group: "g" }]);
    expect(await flagUnclearSets(fake({ rpc: { flag_unclear_sets: { error: { message: "no" } } } }).client, "g", "a")).toBe(0);
  });

  it("the review list: still-unclear first, then newest first, each as entered", async () => {
    const row = (id: string, date: string, flag: string, weight: number | null) => ({
      id,
      weight,
      reps: 5,
      data_flag: flag,
      data_flag_reason: "Reps over 100",
      session_exercises: { exercise_name: "Squat", session_id: "s-" + id, athlete_sessions: { started_at: date + "T12:00:17+00:00" } },
    });
    const { client } = fake({ rows: [row("a", "2026-01-01", "accepted", 200), row("b", "2025-01-01", "unclear", 2), row("c", "2026-03-01", "unclear", null)] });
    const list = await listUnclearPoints(client, "g", "a");
    expect(list.map((p) => p.id)).toEqual(["c", "b", "a"]);
    expect(list[0]).toMatchObject({ date: "2026-03-01", exerciseName: "Squat", weight: null, reps: 5, flag: "unclear", sessionId: "s-c" });
  });

  it("the coach's decision goes through the database function", async () => {
    const { client, calls } = fake({});
    expect(await setUnclearPointCounted(client, "s1", true)).toBeNull();
    expect(calls.rpc[0]).toEqual(["set_unclear_point_counted", { p_set: "s1", p_counts: true }]);
    expect(await setUnclearPointCounted(fake({ rpc: { set_unclear_point_counted: { error: { message: "x" } } } }).client, "s1", false)).toBe("Couldn't save that. Try again.");
  });

  it("fixing by hand: bad numbers are refused before anything is written; a good fix is saved and counted", async () => {
    const bad = fake({});
    expect(await fixUnclearPoint(bad.client, "s1", -5, 5)).toBe("Use whole reps and a weight of zero or more.");
    expect(await fixUnclearPoint(bad.client, "s1", 100, 2.5)).toBe("Use whole reps and a weight of zero or more.");
    expect(await fixUnclearPoint(bad.client, "s1", Number.NaN, 5)).toBe("Use whole reps and a weight of zero or more.");
    expect(bad.calls.updates).toEqual([]);
    const good = fake({});
    expect(await fixUnclearPoint(good.client, "s1", 200, 5)).toBeNull();
    expect(good.calls.updates).toEqual([{ weight: 200, reps: 5 }]);
    expect(good.calls.rpc[0]).toEqual(["set_unclear_point_counted", { p_set: "s1", p_counts: true }]);
    // blank stays blank
    const blank = fake({});
    await fixUnclearPoint(blank.client, "s1", null, 8);
    expect(blank.calls.updates).toEqual([{ weight: null, reps: 8 }]);
    // nothing changed in the database: no decision is recorded
    const none = fake({ updateRows: [] });
    expect(await fixUnclearPoint(none.client, "s1", 100, 5)).toBe("Couldn't save that. Try again.");
    expect(none.calls.rpc).toEqual([]);
  });
});

describe("where it shows", () => {
  it("History page: the baseline note, the review list; the FitPros import and the other uploads run the check", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/history/page.tsx");
    expect(page).toContain("UnclearPointsReview");
    expect(page).toContain("{IMPORT_BASELINE_NOTE} {IMPORT_UNITS_NOTE}");
    expect(read("components/coach/fitpros-history-import.tsx")).toContain("await flagUnclearSets(supabase, groupId, athleteId)");
    const uploader = read("components/coach/exercise-history-uploader.tsx");
    expect((uploader.match(/flagUnclearSets\(supabase, groupId, athleteId\)/g) ?? []).length).toBe(2);
  });
  it("the session shows the mark under the exercise, and only a viewer who is not the client can decide", () => {
    expect(read("app/sessions/[sessionId]/page.tsx")).toContain("weight_confirmed, data_flag, data_flag_reason )");
    const card = read("components/logging/exercise-card.tsx");
    expect(card).toContain("canDecide={viewerId !== null && viewerId !== athleteId}");
    const note = read("components/logging/unclear-points-note.tsx");
    expect(note).toContain("Count it");
    expect(note).toContain("unclearLabel(s.dataFlag)");
  });
  it("the migration keeps the numbers as entered and lets only a coach change a mark", () => {
    const sql = read("supabase/migrations/0371_unclear_data_points.sql");
    expect(sql).toContain("guard_set_log_flag_columns");
    expect(sql).not.toMatch(/update public\.set_logs\s+set\s+(weight|reps)/i);
  });
});
