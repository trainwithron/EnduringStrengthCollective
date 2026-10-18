import { beforeEach, describe, expect, it, vi } from "vitest";
import { inflateSync } from "node:zlib";
import * as XLSX from "xlsx";

const state = vi.hoisted(() => ({
  user: { id: "coach-1" } as { id: string } | null,
  tables: {} as Record<string, { data: any; error?: any }>,
  limited: false,
  seen: [] as string[],
}));

// A stand-in for the database client: every method returns the same chain, and awaiting it answers from the table's script (a page at a time for .range).
function fakeDb(tables: Record<string, { data: any; error?: any }>) {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from(table: string) {
      state.seen.push(table);
      let from = 0;
      let to = 999;
      let paged = false;
      const chain: any = {};
      for (const m of ["select", "eq", "in", "order", "neq", "is", "gte", "lte"]) chain[m] = () => chain;
      chain.range = (f: number, t: number) => {
        from = f;
        to = t;
        paged = true;
        return chain;
      };
      const answer = () => {
        const t = tables[table] ?? { data: null };
        if (t.error) return { data: null, error: t.error };
        const rows = t.data;
        return { data: paged && Array.isArray(rows) ? rows.slice(from, to + 1) : rows, error: null };
      };
      // a single-row read of a table scripted with several rows answers with the first
      const first = () => {
        const a = answer();
        return { data: Array.isArray(a.data) ? (a.data[0] ?? null) : a.data, error: a.error };
      };
      chain.maybeSingle = async () => first();
      chain.single = async () => first();
      chain.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => fakeDb(state.tables) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => (state.limited ? new Response(JSON.stringify({ error: "slow down" }), { status: 429 }) : null) }));

import { loadSheetModel } from "@/lib/team-sheet/load-sheet";
import { GET } from "@/app/api/team-sheet/download/route";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const G = uuid(1);
const input = { groupId: G, mode: "day" as const, date: "2026-10-21", perRack: 4, unit: "lb" as const };

function seed(over: Partial<Record<string, { data: any; error?: any }>> = {}) {
  state.tables = {
    groups: { data: { id: G, name: "Varsity Football", group_kind: "team" } },
    workouts: { data: [{ id: uuid(10), title: "Lower A", scheduled_date: "2026-10-21", day_index: 1 }] },
    group_workout_exercises: {
      data: [
        { id: uuid(20), workout_id: uuid(10), exercise_name: "Back squat", exercise_order: 1, prescribed_sets: 3, prescribed_reps: "5", prescribed_load_note: null, group_workout_exercise_sets: [] },
        { id: uuid(21), workout_id: uuid(10), exercise_name: "Plank", exercise_order: 2, prescribed_sets: 3, prescribed_reps: null, prescribed_load_note: null, group_workout_exercise_sets: [{ set_order: 1, target_reps: null, target_time_seconds: 45, target_distance: null }] },
      ],
    },
    group_memberships: { data: [{ profile_id: uuid(31), profiles: { full_name: "Marcus Taylor" } }, { profile_id: uuid(32), profiles: [{ full_name: "Devon Rivers" }] }, { profile_id: uuid(33), profiles: { full_name: "Eli Stone" } }] },
    profiles: { data: { timezone: "America/Los_Angeles" } },
    ...over,
  } as any;
}

beforeEach(() => {
  state.user = { id: "coach-1" };
  state.limited = false;
  state.seen = [];
  seed();
});

describe("loading the team sheet", () => {
  it("a day sheet: that day's workout, its exercises in order, the roster in racks", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.groupName).toBe("Varsity Football");
    expect(r.model.days).toHaveLength(1);
    expect(r.model.days[0].title).toBe("Lower A");
    expect(r.model.days[0].exercises.map((e) => e.name)).toEqual(["Back squat", "Plank"]);
    expect(r.model.days[0].exercises[0]).toMatchObject({ prescription: "3x5", sets: 3, reps: 5, unread: false });
    expect(r.model.days[0].exercises[1].unread).toBe(true);
    expect(r.model.racks.map((k) => k.athletes.map((a) => a.name))).toEqual([["Devon R.", "Eli S.", "Marcus T."]]);
  });

  it("racks are in surname order with First L. names", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), { ...input, perRack: 2 });
    expect(r.ok && r.model.racks.map((k) => k.athletes.map((a) => a.name))).toEqual([["Devon R.", "Eli S."], ["Marcus T."]]);
  });

  it("a day with no workout says so and says what to do", async () => {
    seed({ workouts: { data: [] } });
    const r = await loadSheetModel(fakeDb(state.tables), input);
    expect(r).toMatchObject({ ok: false, status: 404 });
    if (!r.ok) expect(r.error).toContain("Wed Oct 21");
  });

  it("a week sheet keeps only the days that have a workout", async () => {
    seed({
      workouts: { data: [{ id: uuid(10), title: "Lower A", scheduled_date: "2026-10-19", day_index: 1 }, { id: uuid(11), title: "Upper", scheduled_date: "2026-10-21", day_index: 1 }] },
      group_workout_exercises: {
        data: [
          { id: uuid(20), workout_id: uuid(10), exercise_name: "Back squat", exercise_order: 1, prescribed_sets: 3, prescribed_reps: "5", prescribed_load_note: null, group_workout_exercise_sets: [] },
          { id: uuid(21), workout_id: uuid(11), exercise_name: "Bench press", exercise_order: 1, prescribed_sets: 4, prescribed_reps: "5", prescribed_load_note: null, group_workout_exercise_sets: [] },
        ],
      },
    });
    const r = await loadSheetModel(fakeDb(state.tables), { ...input, mode: "week", date: "2026-10-23" });
    expect(r.ok && r.model.days.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-21"]);
  });

  it("two workouts on one day are one block, in order", async () => {
    seed({
      workouts: { data: [{ id: uuid(10), title: "Lift", scheduled_date: "2026-10-21", day_index: 1 }, { id: uuid(11), title: "Speed", scheduled_date: "2026-10-21", day_index: 2 }] },
      group_workout_exercises: {
        data: [
          { id: uuid(20), workout_id: uuid(10), exercise_name: "Squat", exercise_order: 1, prescribed_sets: 3, prescribed_reps: "5", prescribed_load_note: null, group_workout_exercise_sets: [] },
          { id: uuid(21), workout_id: uuid(11), exercise_name: "Sprint", exercise_order: 1, prescribed_sets: 3, prescribed_reps: "1", prescribed_load_note: null, group_workout_exercise_sets: [] },
        ],
      },
    });
    const r = await loadSheetModel(fakeDb(state.tables), input);
    expect(r.ok && r.model.days[0].title).toBe("Lift / Speed");
    expect(r.ok && r.model.days[0].exercises.map((e) => e.name)).toEqual(["Squat", "Sprint"]);
  });

  it("refuses a one-on-one client's space, an empty workout, an empty roster, too many exercises", async () => {
    seed({ groups: { data: { id: G, name: "Ann", group_kind: "one_on_one" } } });
    expect(await loadSheetModel(fakeDb(state.tables), input)).toMatchObject({ ok: false, status: 409 });
    seed({ group_workout_exercises: { data: [] } });
    expect(await loadSheetModel(fakeDb(state.tables), input)).toMatchObject({ ok: false, status: 404 });
    seed({ group_memberships: { data: [] } });
    expect(await loadSheetModel(fakeDb(state.tables), input)).toMatchObject({ ok: false, status: 404 });
    seed({
      group_workout_exercises: { data: Array.from({ length: 41 }, (_, i) => ({ id: uuid(100 + i), workout_id: uuid(10), exercise_name: `E${i}`, exercise_order: i, prescribed_sets: 3, prescribed_reps: "5", prescribed_load_note: null, group_workout_exercise_sets: [] })) },
    });
    const many = await loadSheetModel(fakeDb(state.tables), input);
    expect(many).toMatchObject({ ok: false, status: 422 });
    if (!many.ok) expect(many.error).toContain("Day sheet");
  });

  it("a failed read is an error to try again, never an empty sheet", async () => {
    for (const table of ["groups", "workouts", "group_workout_exercises", "group_memberships"]) {
      seed({ [table]: { data: null, error: { message: "boom" } } });
      const r = await loadSheetModel(fakeDb(state.tables), input);
      expect(r, table).toMatchObject({ ok: false, status: 502 });
    }
  });

  it("a bad date is refused", async () => {
    expect(await loadSheetModel(fakeDb(state.tables), { ...input, date: "2026-02-30" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the download route", () => {
  const url = (q: Record<string, string>) => `https://app.test/api/team-sheet/download?${new URLSearchParams({ groupId: G, mode: "day", date: "2026-10-21", format: "pdf", perRack: "4", unit: "lb", ...q })}`;
  const get = (q: Record<string, string> = {}) => GET(new Request(url(q)));
  beforeEach(() => {
    state.tables.group_memberships = { data: [{ role: "coach", profile_id: uuid(31), profiles: { full_name: "Marcus Taylor" } }] } as any;
  });

  it("a coach gets a PDF as a download", async () => {
    // the membership lookup (one row, role coach) and the roster read share a table in this fake: the roster rows carry role coach too, which the loader does not look at
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="team-sheet-varsity-football-2026-10-21\.pdf"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 8).toString()).toBe("%PDF-1.4");
    const s = body.toString("latin1");
    const inflated = Array.from(s.matchAll(/stream\n([\s\S]*?)\nendstream/g)).map((m) => inflateSync(Buffer.from(m[1], "latin1")).toString("latin1")).join("\n");
    expect(inflated).toContain("Back squat");
  });

  it("or an Excel file, and the week's file is named for the week", async () => {
    const res = await get({ format: "xlsx", mode: "week" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("team-sheet-varsity-football-week-of-2026-10-21.xlsx");
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    expect(wb.SheetNames).toContain("_codes");
  });

  it("rack size outside 1 to 6 is brought back into range, not refused", async () => {
    expect((await get({ perRack: "99" })).status).toBe(200);
    expect((await get({ perRack: "0" })).status).toBe(200);
  });

  it("refuses: not signed in, not a coach of the group, a bad request, too many downloads", async () => {
    state.user = null;
    expect((await get()).status).toBe(401);
    state.user = { id: "u" };
    state.tables.group_memberships = { data: { role: "athlete" } } as any;
    expect((await get()).status).toBe(403);
    state.tables.group_memberships = { data: { role: "coach" } } as any;
    for (const bad of <Record<string, string>[]>[{ groupId: "nope" }, { mode: "month" }, { format: "docx" }, { date: "2026-02-30" }, { date: "" }, { perRack: "abc" }]) expect((await get(bad)).status, JSON.stringify(bad)).toBe(400);
    state.limited = true;
    expect((await get()).status).toBe(429);
  });

  it("a failed access check is an error, not a permission", async () => {
    state.tables.group_memberships = { data: null, error: { message: "boom" } } as any;
    expect((await get()).status).toBe(502);
  });

  it("says plainly when there is nothing to print", async () => {
    state.tables.group_memberships = { data: { role: "coach" } } as any;
    state.tables.workouts = { data: [] };
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("No workout is scheduled");
  });
});
