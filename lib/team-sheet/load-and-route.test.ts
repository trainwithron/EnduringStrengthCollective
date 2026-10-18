import { beforeEach, describe, expect, it, vi } from "vitest";
import { inflateSync } from "node:zlib";
import * as XLSX from "xlsx";

const state = vi.hoisted(() => ({
  user: { id: "coach-1" } as { id: string } | null,
  tables: {} as Record<string, { data: any; error?: any }>,
  limited: false,
}));

// A stand-in for the database client: every method returns the same chain, and awaiting it answers from the table's script (a page at a time for .range). .is(column, null) and .in(column, values) filter the scripted
// rows, so a test can see an exercise or a program that should be left out being left out.
function fakeDb(tables: Record<string, { data: any; error?: any }>) {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from(table: string) {
      let from = 0;
      let to = 999;
      let paged = false;
      const filters: ((row: any) => boolean)[] = [];
      const chain: any = {};
      for (const m of ["select", "eq", "order", "neq", "gte", "lte"]) chain[m] = () => chain;
      chain.is = (col: string, val: unknown) => {
        filters.push((row) => (row?.[col] ?? null) === val);
        return chain;
      };
      chain.in = (col: string, vals: unknown[]) => {
        filters.push((row) => !(col in (row ?? {})) || vals.includes(row[col]));
        return chain;
      };
      chain.range = (f: number, t: number) => {
        from = f;
        to = t;
        paged = true;
        return chain;
      };
      const answer = () => {
        const t = tables[table] ?? { data: null };
        if (t.error) return { data: null, error: t.error };
        const rows = Array.isArray(t.data) ? t.data.filter((row: any) => filters.every((fn) => fn(row))) : t.data;
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

import { loadSheetModel, loadSheetOptions } from "@/lib/team-sheet/load-sheet";
import { GET } from "@/app/api/team-sheet/download/route";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const G = uuid(1);
const P = uuid(5);
// an exercise row as the database returns it: sets are rows, tracked_fields says what is recorded
const gwe = (id: string, workout: string, name: string, order: number, over: Record<string, unknown> = {}, sets = 3, reps: string | null = "5") => ({
  id,
  workout_id: workout,
  exercise_name: name,
  display_name: null,
  exercise_order: order,
  athlete_id: null,
  tracked_fields: ["reps", "weight"],
  group_workout_exercise_sets: Array.from({ length: sets }, (_, i) => ({ set_order: i + 1, target_reps: reps, target_time_seconds: null, target_distance: null })),
  ...over,
});
// a program with no dates at all, as the Trojans' program is: workouts in sequence, week and day
const program = (over: Record<string, unknown> = {}) => ({ id: P, name: "Fall", created_at: "2026-10-01T00:00:00Z", start_date: "2026-09-14", training_days: null, athlete_id: null, ...over });
const workout = (id: number, title: string, week: number, dayIndex: number, over: Record<string, unknown> = {}) => ({ id: uuid(id), program_id: P, title, week_number: week, day_index: dayIndex, ...over });

const day = (over: Record<string, unknown> = {}) => ({ groupId: G, mode: "day" as const, workoutId: uuid(10), date: "2026-10-21", perRack: 4, unit: "lb" as const, ...over }) as Parameters<typeof loadSheetModel>[1];
const week = (over: Record<string, unknown> = {}) => ({ groupId: G, mode: "week" as const, programId: P, week: 1, start: "2026-10-19", days: [1, 3, 5], perRack: 4, unit: "lb" as const, ...over }) as Parameters<typeof loadSheetModel>[1];

function seed(over: Partial<Record<string, { data: any; error?: any }>> = {}) {
  state.tables = {
    groups: { data: { id: G, name: "Varsity Football", group_kind: "team" } },
    programs: { data: [program()] },
    workouts: { data: [workout(10, "Lower A", 1, 1), workout(11, "Upper", 1, 2), workout(12, "Lower B", 1, 3), workout(13, "Lower A again", 2, 1)] },
    group_workout_exercises: {
      data: [
        gwe(uuid(20), uuid(10), "Back squat", 1),
        gwe(uuid(21), uuid(10), "Plank", 2, { tracked_fields: ["time"] }, 1, null),
        gwe(uuid(22), uuid(10), "Pull-up", 3, { tracked_fields: ["reps"] }, 3, "8"),
        gwe(uuid(23), uuid(10), "Bench (Marcus only)", 4, { athlete_id: uuid(31) }),
        gwe(uuid(24), uuid(10), "Hang clean", 5, { display_name: "Power clean" }, 4, "3"),
        gwe(uuid(30), uuid(11), "Bench press", 1, {}, 4, "5"),
        gwe(uuid(31), uuid(12), "Trap bar deadlift", 1, {}, 5, "3"),
        gwe(uuid(32), uuid(13), "Back squat", 1),
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
  seed();
});

describe("what the Team sheet page offers", () => {
  it("the group's active shared programs, their weeks and workouts in order, and the training days when there are any", async () => {
    seed({ programs: { data: [program({ training_days: [1, 3, 5] })] } });
    const r = await loadSheetOptions(fakeDb(state.tables), G);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.options.programs).toHaveLength(1);
    expect(r.options.programs[0]).toMatchObject({ id: P, name: "Fall", trainingDays: [1, 3, 5] });
    expect(r.options.programs[0].weeks.map((w) => [w.week, w.workouts.map((x) => x.title)])).toEqual([[1, ["Lower A", "Upper", "Lower B"]], [2, ["Lower A again"]]]);
  });
  it("a program with no days set offers none, and a program made for one athlete is not offered", async () => {
    const r = await loadSheetOptions(fakeDb(state.tables), G);
    expect(r.ok && r.options.programs[0].trainingDays).toEqual([]);
    seed({ programs: { data: [program({ athlete_id: uuid(31) })] } });
    const none = await loadSheetOptions(fakeDb(state.tables), G);
    expect(none.ok && none.options.programs).toEqual([]);
  });
  it("a failed read is an error, not an empty list", async () => {
    seed({ programs: { data: null, error: { message: "boom" } } });
    expect((await loadSheetOptions(fakeDb(state.tables), G)).ok).toBe(false);
  });
});

describe("loading a day sheet", () => {
  it("one workout on the date the coach picks: its exercises in order, the roster in racks", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), day());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.groupName).toBe("Varsity Football");
    expect(r.model.mode).toBe("day");
    expect(r.model.days).toHaveLength(1);
    expect(r.model.days[0]).toMatchObject({ date: "2026-10-21", label: "Wed Oct 21", title: "Lower A" });
    expect(r.model.days[0].exercises.map((e) => e.name)).toEqual(["Back squat", "Plank", "Pull-up", "Power clean"]);
    expect(r.model.days[0].exercises[0]).toMatchObject({ prescription: "3x5", sets: 3, reps: 5, unread: false });
    // a timed exercise (nothing weighed, nothing counted) is left for Notes
    expect(r.model.days[0].exercises[1].unread).toBe(true);
    // reps only: the box holds reps, and the sheet says so
    expect(r.model.days[0].exercises[2]).toMatchObject({ prescription: "3x8 reps", unread: false, repsOnly: true });
    // an exercise written for one athlete is not on the team's sheet; the coach's display name is what is printed
    expect(r.model.days[0].exercises.some((e) => /Marcus only/.test(e.name))).toBe(false);
    expect(r.model.days[0].exercises[3]).toMatchObject({ name: "Power clean", prescription: "4x3" });
    expect(r.model.racks.map((k) => k.athletes.map((a) => a.name))).toEqual([["Devon R.", "Eli S.", "Marcus T."]]);
  });

  it("the workout does not need a date in its program: the coach's date is the date", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), day({ date: "2027-01-05" }));
    expect(r.ok && r.model.days[0].date).toBe("2027-01-05");
  });

  it("a workout that is not in an active program of this group is refused", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), day({ workoutId: uuid(999) }));
    expect(r).toMatchObject({ ok: false, status: 404 });
    seed({ programs: { data: [] }, workouts: { data: [] } });
    const none = await loadSheetModel(fakeDb(state.tables), day());
    expect(none).toMatchObject({ ok: false, status: 404 });
    if (!none.ok) expect(none.error).toContain("no active program");
  });

  it("racks are in surname order with First L. names", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), day({ perRack: 2 }));
    expect(r.ok && r.model.racks.map((k) => k.athletes.map((a) => a.name))).toEqual([["Devon R.", "Eli S."], ["Marcus T."]]);
  });
});

describe("loading a week sheet", () => {
  it("one week of the program: its workouts in order, on the training days chosen", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), week());
    expect(r.ok && r.model.days.map((d) => [d.date, d.label, d.title])).toEqual([
      ["2026-10-19", "Mon Oct 19", "Lower A"],
      ["2026-10-21", "Wed Oct 21", "Upper"],
      ["2026-10-23", "Fri Oct 23", "Lower B"],
    ]);
  });

  it("any day of the week will do as the start, and the days come out in week order whatever order they were chosen", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), week({ start: "2026-10-23", days: [5, 1, 3] }));
    expect(r.ok && r.model.days.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-21", "2026-10-23"]);
    // Sunday, Tuesday, Thursday of the Monday-to-Sunday week that holds Sunday Oct 25: Tue 20, Thu 22, Sun 25
    const odd = await loadSheetModel(fakeDb(state.tables), week({ start: "2026-10-25", days: [0, 2, 4] }));
    expect(odd.ok && odd.model.days.map((d) => d.date)).toEqual(["2026-10-20", "2026-10-22", "2026-10-25"]);
  });

  it("another week of the same program", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), week({ week: 2, start: "2026-10-26" }));
    expect(r.ok && r.model.days.map((d) => [d.date, d.title])).toEqual([["2026-10-26", "Lower A again"]]);
  });

  it("more workouts than training days is refused with what to do", async () => {
    const r = await loadSheetModel(fakeDb(state.tables), week({ days: [1, 3] }));
    expect(r).toMatchObject({ ok: false, status: 422 });
    if (!r.ok) expect(r.error).toMatch(/3 workouts but only 2 training days/);
    expect(await loadSheetModel(fakeDb(state.tables), week({ days: [] }))).toMatchObject({ ok: false, status: 400 });
  });

  it("a week the program does not have, or a program that is not active, is refused", async () => {
    expect(await loadSheetModel(fakeDb(state.tables), week({ week: 9 }))).toMatchObject({ ok: false, status: 404 });
    expect(await loadSheetModel(fakeDb(state.tables), week({ programId: uuid(404) }))).toMatchObject({ ok: false, status: 404 });
  });

  it("a program made for one athlete is not on the team's sheet", async () => {
    seed({ programs: { data: [program({ athlete_id: uuid(31) })] } });
    const r = await loadSheetModel(fakeDb(state.tables), week());
    expect(r).toMatchObject({ ok: false, status: 404 });
    if (!r.ok) expect(r.error).toContain("no active program");
  });
});

describe("loading: refusals and failures", () => {
  it("refuses a one-on-one client's space, a workout with no team exercises, an empty roster, too many exercises", async () => {
    seed({ groups: { data: { id: G, name: "Ann", group_kind: "one_on_one" } } });
    expect(await loadSheetModel(fakeDb(state.tables), day())).toMatchObject({ ok: false, status: 409 });
    seed({ group_workout_exercises: { data: [] } });
    expect(await loadSheetModel(fakeDb(state.tables), day())).toMatchObject({ ok: false, status: 404 });
    seed({ group_memberships: { data: [] } });
    expect(await loadSheetModel(fakeDb(state.tables), day())).toMatchObject({ ok: false, status: 404 });
    seed({ group_workout_exercises: { data: Array.from({ length: 41 }, (_, i) => gwe(uuid(100 + i), uuid(10), `E${i}`, i)) } });
    const many = await loadSheetModel(fakeDb(state.tables), day());
    expect(many).toMatchObject({ ok: false, status: 422 });
    if (!many.ok) expect(many.error).toContain("Day sheet");
  });

  it("a failed read is an error to try again, never an empty sheet", async () => {
    for (const table of ["groups", "programs", "group_workout_exercises", "group_memberships"]) {
      seed({ [table]: { data: null, error: { message: "boom" } } });
      const r = await loadSheetModel(fakeDb(state.tables), day());
      expect(r, table).toMatchObject({ ok: false, status: 502 });
    }
  });

  it("a bad date is refused", async () => {
    expect(await loadSheetModel(fakeDb(state.tables), day({ date: "2026-02-30" }))).toMatchObject({ ok: false, status: 400 });
    expect(await loadSheetModel(fakeDb(state.tables), week({ start: "nope" }))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the download route", () => {
  const dayQuery = { groupId: G, mode: "day", workoutId: uuid(10), date: "2026-10-21", format: "pdf", perRack: "4", unit: "lb" };
  const weekQuery = { groupId: G, mode: "week", programId: P, week: "1", start: "2026-10-19", days: "1,3,5", format: "pdf", perRack: "4", unit: "lb" };
  const get = (q: Record<string, string> = {}, base: Record<string, string> = dayQuery) => GET(new Request(`https://app.test/api/team-sheet/download?${new URLSearchParams({ ...base, ...q })}`));
  beforeEach(() => {
    state.tables.group_memberships = { data: [{ role: "coach", profile_id: uuid(31), profiles: { full_name: "Marcus Taylor" } }] } as any;
  });

  it("a coach gets a PDF as a download", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="team-sheet-varsity-football-2026-10-21.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 8).toString()).toBe("%PDF-1.4");
    const s = body.toString("latin1");
    const inflated = Array.from(s.matchAll(/stream\n([\s\S]*?)\nendstream/g)).map((m) => inflateSync(Buffer.from(m[1], "latin1")).toString("latin1")).join("\n");
    expect(inflated).toContain("Back squat");
  });

  it("a week sheet as an Excel file, named for the week", async () => {
    const res = await get({ format: "xlsx" }, weekQuery);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("team-sheet-varsity-football-week-of-2026-10-19.xlsx");
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    expect(wb.SheetNames).toContain("_codes");
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Rack 1"], { header: 1, defval: "" }).flat().join("|")).toContain("Wed Oct 21 - Upper");
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
    state.tables.group_memberships = { data: [{ role: "coach", profile_id: uuid(31), profiles: { full_name: "Marcus Taylor" } }] } as any;
    for (const bad of [{ groupId: "nope" }, { mode: "month" }, { format: "docx" }, { date: "2026-02-30" }, { date: "" }, { workoutId: "x" }, { perRack: "abc" }] as Record<string, string>[]) expect((await get(bad)).status, JSON.stringify(bad)).toBe(400);
    for (const bad of [{ programId: "x" }, { week: "1.5" }, { week: "-1" }, { week: "9999" }, { start: "2026-02-30" }, { days: "" }, { days: "7" }, { days: "1,x" }, { days: "0,1,2,3,4,5,6,0,1,2,3,4,5,6,1,1" }] as Record<string, string>[]) {
      const status = (await get(bad, weekQuery)).status;
      // a repeated list of valid days is just those days; everything else is refused
      expect(status, JSON.stringify(bad)).toBe(bad.days?.startsWith("0,1,2,3,4,5,6,0") ? 200 : 400);
    }
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
    expect((await res.json()).error).toContain("not in the group");
  });
});
