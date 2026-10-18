import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const state = vi.hoisted(() => ({
  user: { id: "coach-1" } as { id: string } | null,
  tables: {} as Record<string, { data: any; error?: any }>,
  rpc: { data: null as any, error: null as any },
  rpcCalls: [] as { name: string; args: any }[],
  rpcQueue: [] as { data: any; error: any }[],
  piece: 50,
  limited: false,
}));

function fakeDb() {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name: string, args: any) => {
      state.rpcCalls.push({ name, args });
      const queued = state.rpcQueue.shift();
      return queued ?? { data: state.rpc.data, error: state.rpc.error };
    },
    from(table: string) {
      let from = 0;
      let to = 999;
      let paged = false;
      const filters: ((row: any) => boolean)[] = [];
      const chain: any = {};
      for (const m of ["select", "eq", "order", "neq", "gte", "lte", "is", "limit"]) chain[m] = () => chain;
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
        const t = state.tables[table] ?? { data: null };
        if (t.error) return { data: null, error: t.error };
        const rows = Array.isArray(t.data) ? t.data.filter((row: any) => filters.every((fn) => fn(row))) : t.data;
        return { data: paged && Array.isArray(rows) ? rows.slice(from, to + 1) : rows, error: null };
      };
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

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => fakeDb() }));
vi.mock("@/lib/team-sheet/save-pieces", () => ({ savePiece: () => state.piece }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => (state.limited ? new Response(JSON.stringify({ error: "slow down" }), { status: 429 }) : null) }));
vi.mock("@/lib/timezone", async (original) => ({ ...(await original<typeof import("@/lib/timezone")>()), getGroupCoachTimezone: async () => "America/New_York" }));

import { POST as upload } from "@/app/api/team-sheet/upload/route";
import { POST as save } from "@/app/api/team-sheet/save/route";
import { POST as undo } from "@/app/api/team-sheet/undo/route";
import { buildSheetWorkbook } from "@/lib/team-sheet/export-xlsx";
import { dayLabel, makeRacks, type SheetExercise, type SheetModel } from "@/lib/team-sheet/sheet-model";
import { encodeSheetCode } from "@/lib/team-sheet/sheet-code";
import { rackCode } from "@/lib/team-sheet/export-pdf";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const G = uuid(1);
const MON = uuid(50);
const ex = (n: number, name: string): SheetExercise => ({ id: uuid(100 + n), name, prescription: "3x5", sets: 3, reps: 5, unread: false });
const model = (groupId = G): SheetModel => ({
  groupId,
  groupName: "Varsity Football",
  mode: "day",
  unit: "lb",
  days: [{ date: "2026-10-19", label: dayLabel("2026-10-19"), title: "Lower A", exercises: [ex(1, "Back squat"), ex(2, "Bench press")] }],
  racks: makeRacks([{ id: uuid(11), fullName: "Ann Adams" }, { id: uuid(12), fullName: "Bo Brown" }], 4),
});
const gwe = (n: number, name: string) => ({ id: uuid(100 + n), workout_id: MON, exercise_name: name, display_name: null, tracked_fields: ["reps", "weight"], group_workout_exercise_sets: [1, 2, 3].map((i) => ({ set_order: i, target_reps: "5" })) });

function seed(over: Partial<Record<string, { data: any; error?: any }>> = {}) {
  state.tables = {
    // one table serves the coach check (first row) and the roster read, so every row says coach
    group_memberships: { data: [{ role: "coach", profile_id: uuid(11), profiles: { full_name: "Ann Adams" } }, { role: "coach", profile_id: uuid(12), profiles: { full_name: "Bo Brown" } }] },
    group_workout_exercises: { data: [gwe(1, "Back squat"), gwe(2, "Bench press")] },
    workouts: { data: [{ id: MON, title: "Lower A" }] },
    athlete_sessions: { data: [] },
    team_sheet_batches: { data: { id: uuid(70), group_id: G } },
    ...over,
  } as any;
}

function filledXlsx(g = G, fillCells = true): Buffer {
  const wb = buildSheetWorkbook(model(g));
  if (fillCells) {
    const ws = wb.Sheets["Rack 1"];
    const range = XLSX.utils.decode_range(ws["!ref"]!);
    let header = 0;
    for (let r = 0; r <= range.e.r; r++) if (ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v === "Athlete") header = r;
    XLSX.utils.sheet_add_aoa(ws, [["225 235 245", "185x5"]], { origin: { r: header + 2, c: 1 } });
    XLSX.utils.sheet_add_aoa(ws, [[300, "2?5"]], { origin: { r: header + 3, c: 1 } });
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
const uploadReq = (file: Buffer | null, name = "sheet.xlsx", fields: Record<string, string> = { groupId: G }) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", new File([new Uint8Array(file)], name));
  return new Request("https://app.test/api/team-sheet/upload", { method: "POST", body: form });
};
const json = (url: string, body: unknown) => new Request(`https://app.test/api/team-sheet/${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  state.user = { id: "coach-1" };
  state.limited = false;
  state.rpc = { data: null, error: null };
  state.rpcCalls = [];
  state.rpcQueue = [];
  state.piece = 50;
  seed();
});

describe("the upload route", () => {
  it("a coach uploads a filled sheet and gets the review back: nothing is saved", async () => {
    const res = await upload(uploadReq(filledXlsx()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("xlsx");
    expect(body.review.groupId).toBe(G);
    expect(body.review.sheets[0].rows[0].days[0][0].described).toBe("225 lb x 5, 235 lb x 5, 245 lb x 5 (reps from the sheet)");
    expect(body.review.sheets[0].rows[1].days[0][1].result.kind).toBe("unsure");
    expect(body.review.summary.unsure).toBe(1);
    expect(typeof body.review.sheets[0].codeText).toBe("string");
    expect(state.rpcCalls).toHaveLength(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses: not signed in, not a coach, no file, a file for another group, a bad file, too big, too many", async () => {
    state.user = null;
    expect((await upload(uploadReq(filledXlsx()))).status).toBe(401);
    state.user = { id: "u" };
    seed({ group_memberships: { data: { role: "athlete" } } });
    expect((await upload(uploadReq(filledXlsx()))).status).toBe(403);
    seed();
    expect((await upload(uploadReq(null))).status).toBe(400);
    expect((await upload(uploadReq(filledXlsx(uuid(2))))).status).toBe(422);
    const bad = await upload(uploadReq(Buffer.from("not a sheet"), "x.xlsx"));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/Excel/);
    expect((await upload(uploadReq(Buffer.alloc(6 * 1024 * 1024), "x.xlsx"))).status).toBe(413);
    expect((await upload(uploadReq(filledXlsx(), "sheet.xlsx", { groupId: "nope" }))).status).toBe(400);
    state.limited = true;
    expect((await upload(uploadReq(filledXlsx()))).status).toBe(429);
  });

  it("a failed read of the group is an error, not an empty review", async () => {
    seed({ group_workout_exercises: { data: null, error: { message: "boom" } } });
    expect((await upload(uploadReq(filledXlsx()))).status).toBe(502);
  });
});

describe("the save route", () => {
  const code = () => encodeSheetCode(rackCode(model(), model().racks[0]));
  const body = (over: Record<string, unknown> = {}) => ({
    groupId: G,
    source: "xlsx",
    replace: false,
    sheets: [
      {
        code: code(),
        rows: [
          { athleteId: uuid(11), cells: [["225 235 245", "185x5"]] },
          { athleteId: uuid(12), cells: [["300", "2?5"]] },
        ],
      },
    ],
    ...over,
  });
  // the athletes in the code are in surname order: Adams, Brown
  it("saves what the coach left in the boxes, worked out again on the server, through the database function", async () => {
    state.rpc = { data: { batch: uuid(70), saved: 2, kept: 0, replaced: 0, records: 1, skipped: [] }, error: null };
    const res = await save(json("save", body()));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ saved: 2, records: 1, droppedUnsure: 1 });
    expect(state.rpcCalls).toHaveLength(1);
    const call = state.rpcCalls[0];
    expect(call.name).toBe("team_sheet_save");
    expect(call.args.p_group).toBe(G);
    expect(call.args.p_source).toBe("xlsx");
    expect(call.args.p_replace).toBe(false);
    const rows = call.args.p_rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ athlete_id: uuid(11), workout_id: MON, day: "2026-10-19", at: "2026-10-19T16:00:00.000Z" });
    expect(rows[0].exercises[0]).toEqual({ id: uuid(101), sets: [{ weight: 225, reps: 5 }, { weight: 235, reps: 5 }, { weight: 245, reps: 5 }] });
    // Bo's unsure box saved nothing; his 300 became three sets
    expect(rows[1].exercises).toHaveLength(1);
    expect(rows[1].exercises[0].sets).toHaveLength(3);
  });

  it("the browser cannot say what a box means: only the code and the text count; what the athlete is called, a weight it claims to have parsed, or an extra field changes nothing", async () => {
    state.rpc = { data: { batch: uuid(70), saved: 1, kept: 0, replaced: 0, records: 0, skipped: [] }, error: null };
    const b: any = body();
    b.sheets[0].rows[0].parsed = [{ weight: 9999, reps: 99 }];
    b.sheets[0].rows[0].workoutId = uuid(999);
    b.sheets[0].days = [{ date: "2000-01-01" }];
    await save(json("save", b));
    const rows = state.rpcCalls[0].args.p_rows;
    expect(JSON.stringify(rows)).not.toContain("9999");
    expect(JSON.stringify(rows)).not.toContain(uuid(999));
    expect(JSON.stringify(rows)).not.toContain("2000-01-01");
  });

  it("a turned-off athlete saves nothing, and replace is passed on as asked", async () => {
    state.rpc = { data: { batch: uuid(70), saved: 1, kept: 0, replaced: 1, records: 0, skipped: [] }, error: null };
    const b = body({ replace: true });
    (b.sheets[0].rows[0] as any).skip = true;
    await save(json("save", b));
    const call = state.rpcCalls[0];
    expect(call.args.p_replace).toBe(true);
    expect(call.args.p_rows.map((r: any) => r.athlete_id)).toEqual([uuid(12)]);
  });

  it("refuses a request that does not match its code, or a code that is not valid, or for another group", async () => {
    const cases: [string, unknown][] = [
      ["wrong athlete order", (() => { const b = body(); b.sheets[0].rows.reverse(); return b; })()],
      ["a row missing", (() => { const b = body(); b.sheets[0].rows.pop(); return b; })()],
      ["wrong number of days", (() => { const b: any = body(); b.sheets[0].rows[0].cells = [["1"], ["2"]]; return b; })()],
      ["wrong number of boxes", (() => { const b: any = body(); b.sheets[0].rows[0].cells = [["225"]]; return b; })()],
      ["a damaged code", (() => { const b: any = body(); b.sheets[0].code = b.sheets[0].code.slice(0, -2) + "00"; return b; })()],
      ["no code", (() => { const b: any = body(); b.sheets[0].code = ""; return b; })()],
      ["a code of another group", (() => { const b: any = body(); b.sheets[0].code = encodeSheetCode(rackCode(model(uuid(2)), model(uuid(2)).racks[0])); return b; })()],
      ["the same rack twice", (() => { const b: any = body(); b.sheets.push(b.sheets[0]); return b; })()],
      ["no sheets", body({ sheets: [] })],
    ];
    for (const [label, b] of cases) {
      const res = await save(json("save", b));
      expect([400, 422], label).toContain(res.status);
    }
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("refuses: not signed in, not a coach, nothing readable, an empty or oversized body, too many saves", async () => {
    state.user = null;
    expect((await save(json("save", body()))).status).toBe(401);
    state.user = { id: "u" };
    seed({ group_memberships: { data: { role: "athlete" } } });
    expect((await save(json("save", body()))).status).toBe(403);
    seed();
    expect((await save(json("save", "not json"))).status).toBe(400);
    expect((await save(json("save", ""))).status).toBe(400);
    expect((await save(json("save", "x".repeat(700_000)))).status).toBe(400);
    const empty = await save(json("save", body({ sheets: [{ code: code(), rows: [{ athleteId: uuid(11), cells: [["-", ""]] }, { athleteId: uuid(12), cells: [["", "2?5"]] }] }] })));
    expect(empty.status).toBe(422);
    expect((await empty.json()).droppedUnsure).toBe(1);
    state.limited = true;
    expect((await save(json("save", body()))).status).toBe(429);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("the database's refusals come back as plain words, and nothing is claimed saved", async () => {
    state.rpc = { data: null, error: { message: "not authorized" } };
    expect((await save(json("save", body()))).status).toBe(403);
    state.rpc = { data: null, error: { message: "boom" } };
    const x = await save(json("save", body()));
    expect(x.status).toBe(502);
    expect((await x.json()).error).toMatch(/Nothing was saved/);
  });

  it("a big upload goes in pieces that join into ONE upload: the first starts it, each later one adds to it, only the last asks for the notice", async () => {
    state.piece = 1;
    state.rpcQueue = [
      { data: { batch: uuid(70), saved: 1, kept: 0, replaced: 0, records: 1, skipped: [] }, error: null },
      { data: { batch: uuid(70), saved: 1, kept: 0, replaced: 1, records: 2, skipped: [{ athlete_id: "x", day: "d", why: "w" }] }, error: null },
    ];
    const res = await save(json("save", body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ batch: uuid(70), saved: 2, replaced: 1, records: 2, droppedUnsure: 1 });
    expect(state.rpcCalls).toHaveLength(2);
    expect(state.rpcCalls[0].args).toMatchObject({ p_batch: null, p_last: false });
    expect(state.rpcCalls[0].args.p_rows).toHaveLength(1);
    expect(state.rpcCalls[1].args).toMatchObject({ p_batch: uuid(70), p_last: true });
    expect(state.rpcCalls[1].args.p_rows).toHaveLength(1);
  });

  it("a failure part-way closes the upload that was started and says exactly how many were not saved", async () => {
    state.piece = 1;
    state.rpcQueue = [
      { data: { batch: uuid(70), saved: 1, kept: 0, replaced: 0, records: 0, skipped: [] }, error: null },
      { data: null, error: { message: "boom" } },
      { data: { batch: uuid(70), saved: 0, kept: 0, replaced: 0, records: 0, skipped: [] }, error: null },
    ];
    const res = await save(json("save", body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ partial: true, batch: uuid(70), saved: 1, notSaved: 1 });
    expect(state.rpcCalls).toHaveLength(3);
    expect(state.rpcCalls[2].args).toMatchObject({ p_batch: uuid(70), p_last: true, p_rows: [] });
  });

  it("sheets printed in different units are refused", async () => {
    const kgModel: SheetModel = { ...model(), unit: "kg", racks: [{ ...makeRacks([{ id: uuid(13), fullName: "Cy Clark" }], 4)[0], number: 2 }] };
    const b: any = body();
    b.sheets = [b.sheets[0], { code: encodeSheetCode(rackCode(kgModel, kgModel.racks[0])), rows: [{ athleteId: uuid(13), cells: [["", ""]] }] }];
    const res = await save(json("save", b));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/different units/);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("the undo route", () => {
  it("a coach takes back an upload of their own group", async () => {
    state.rpc = { data: { batch: uuid(70), sessions_removed: 3 }, error: null };
    const res = await undo(json("undo", { groupId: G, batchId: uuid(70) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sessions_removed: 3 });
    expect(state.rpcCalls).toEqual([{ name: "team_sheet_undo", args: { p_batch: uuid(70) } }]);
  });

  it("refuses an upload that belongs to another group, one that was already undone, a bad id, a non-coach", async () => {
    seed({ team_sheet_batches: { data: { id: uuid(70), group_id: uuid(2) } } });
    expect((await undo(json("undo", { groupId: G, batchId: uuid(70) }))).status).toBe(404);
    seed();
    state.rpc = { data: null, error: { message: "that upload was already undone" } };
    expect((await undo(json("undo", { groupId: G, batchId: uuid(70) }))).status).toBe(409);
    expect((await undo(json("undo", { groupId: G, batchId: "nope" }))).status).toBe(400);
    expect((await undo(json("undo", { groupId: "nope", batchId: uuid(70) }))).status).toBe(400);
    seed({ group_memberships: { data: { role: "athlete" } } });
    expect((await undo(json("undo", { groupId: G, batchId: uuid(70) }))).status).toBe(403);
    state.user = null;
    expect((await undo(json("undo", { groupId: G, batchId: uuid(70) }))).status).toBe(401);
  });
});
