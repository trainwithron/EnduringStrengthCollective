import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildSheetWorkbook, CODE_LABEL, CODES_SHEET } from "@/lib/team-sheet/export-xlsx";
import { MAX_UPLOAD_BYTES, readUpload } from "@/lib/team-sheet/read-upload";
import { buildReview, toSaveRows, type Context } from "@/lib/team-sheet/review";
import { dayLabel, makeRacks, type SheetExercise, type SheetModel } from "@/lib/team-sheet/sheet-model";
import { encodeSheetCode } from "@/lib/team-sheet/sheet-code";
import { rackCode } from "@/lib/team-sheet/export-pdf";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const G = uuid(1);
const WORKOUT_MON = uuid(50);
const WORKOUT_WED = uuid(51);
const ex = (n: number, name: string, over: Partial<SheetExercise> = {}): SheetExercise => ({ id: uuid(100 + n), name, prescription: "3x5", sets: 3, reps: 5, unread: false, ...over });

function model(): SheetModel {
  const day = (date: string, title: string, exercises: SheetExercise[]) => ({ date, label: dayLabel(date), title, exercises });
  return {
    groupId: G,
    groupName: "Varsity Football",
    mode: "week",
    unit: "lb",
    days: [day("2026-10-19", "Lower A", [ex(1, "Back squat"), ex(2, "Bench press")]), day("2026-10-21", "Upper", [ex(3, "Pull-up", { prescription: "3x8 reps" }), ex(4, "Plank", { unread: true })])],
    racks: makeRacks(
      [
        { id: uuid(11), fullName: "Ann Adams" },
        { id: uuid(12), fullName: "Bo Brown" },
        { id: uuid(13), fullName: "Cy Clark" },
      ],
      2
    ),
  };
}

// the database as the review sees it: exercise kinds and workouts, the roster, existing sessions
function context(over: Partial<Context> = {}): Context {
  const gwe = (n: number, name: string, workout: string, tracked: string[], reps = "5", sets = 3) => [uuid(100 + n), { id: uuid(100 + n), workout_id: workout, exercise_name: name, display_name: null, tracked_fields: tracked, group_workout_exercise_sets: Array.from({ length: sets }, (_, i) => ({ set_order: i + 1, target_reps: reps })) }] as const;
  return {
    exercises: new Map([gwe(1, "Back squat", WORKOUT_MON, ["reps", "weight"]), gwe(2, "Bench press", WORKOUT_MON, ["reps", "weight"]), gwe(3, "Pull-up", WORKOUT_WED, ["reps"], "8"), gwe(4, "Plank", WORKOUT_WED, ["time"], "", 1)]),
    workoutTitles: new Map([[WORKOUT_MON, "Lower A"], [WORKOUT_WED, "Upper"]]),
    roster: new Map([[uuid(11), "Ann Adams"], [uuid(12), "Bo Brown"], [uuid(13), "Cy Clark"]]),
    sessions: new Set<string>(),
    ...over,
  };
}

// fill a rack sheet of a built workbook: athlete row i, exercise column c (0-based among the exercise columns)
function fill(wb: XLSX.WorkBook, rack: number, i: number, c: number, value: string | number) {
  const ws = wb.Sheets[`Rack ${rack}`];
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  let header = -1;
  for (let r = 0; r <= range.e.r; r++) if (ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v === "Athlete") header = r;
  XLSX.utils.sheet_add_aoa(ws, [[value]], { origin: { r: header + 2 + i, c: 1 + c } });
}
const toBuffer = (wb: XLSX.WorkBook) => Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

describe("reading a filled Excel file", () => {
  it("comes back with each rack's code, each athlete's id in order and the text of every box", () => {
    const m = model();
    const wb = buildSheetWorkbook(m);
    fill(wb, 1, 0, 0, "225 235 245");
    fill(wb, 1, 0, 1, "185x5 195x3");
    fill(wb, 1, 0, 2, "10 10 8");
    fill(wb, 1, 1, 0, 300);
    fill(wb, 2, 0, 0, "-");
    const r = readUpload(toBuffer(wb), "team-sheet.xlsx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("xlsx");
    expect(r.racks.map((k) => k.code.rack)).toEqual([1, 2]);
    expect(r.racks[0].code).toEqual(rackCode(m, m.racks[0]));
    expect(r.racks[0].rows.map((x) => x.athleteId)).toEqual(m.racks[0].athletes.map((a) => a.id));
    expect(r.racks[0].rows[0].cells).toEqual([["225 235 245", "185x5 195x3"], ["10 10 8", ""]]);
    expect(r.racks[0].rows[1].cells[0][0]).toBe("300"); // a number cell
    expect(r.racks[1].rows[0].cells[0][0]).toBe("-");
    expect(r.racks[0].rows[0].printedName).toBe(m.racks[0].athletes[0].name);
  });

  it("a CSV of one rack sheet works because the sheet code is printed in the sheet itself", () => {
    const m = model();
    const wb = buildSheetWorkbook(m);
    fill(wb, 1, 1, 0, "275x5");
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets["Rack 1"]);
    expect(csv).toContain(CODE_LABEL);
    const r = readUpload(Buffer.from(csv, "utf8"), "rack1.csv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("csv");
    expect(r.racks).toHaveLength(1);
    expect(r.racks[0].rows[1].cells[0][0]).toBe("275x5");
  });

  it("a file saved without the hidden codes sheet still reads, from the code in each sheet", () => {
    const wb = buildSheetWorkbook(model());
    delete wb.Sheets[CODES_SHEET];
    wb.SheetNames = wb.SheetNames.filter((n) => n !== CODES_SHEET);
    wb.Workbook = undefined;
    expect(readUpload(toBuffer(wb), "x.xlsx").ok).toBe(true);
  });

  it("is refused with a plain reason when it is not what it should be", () => {
    const bad = (buf: Buffer, name: string) => {
      const r = readUpload(buf, name);
      expect(r.ok, name).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(bad(Buffer.alloc(0), "a.xlsx")).toMatch(/empty/);
    expect(bad(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "a.xlsx")).toMatch(/too large/);
    expect(bad(Buffer.from("hello"), "a.pdf")).toMatch(/Excel file/);
    expect(bad(Buffer.from("hello"), "a.xlsx")).toMatch(/does not look like an Excel/);
    expect(bad(toBuffer(buildSheetWorkbook(model())), "a.csv")).toMatch(/Excel file with a CSV name/);
    expect(bad(Buffer.from("a,b\n1,2\n"), "a.csv")).toMatch(/No team sheet/);
    const empty = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(empty, XLSX.utils.aoa_to_sheet([["nothing"]]), "Notes");
    expect(bad(toBuffer(empty), "a.xlsx")).toMatch(/No team sheet/);
  });

  it("a rack sheet with its code damaged, or with the codes removed everywhere, is refused", () => {
    const wb = buildSheetWorkbook(model());
    const ws = wb.Sheets["Rack 1"];
    for (const key of Object.keys(ws)) if (typeof ws[key]?.v === "string" && ws[key].v.startsWith("TS1.")) ws[key].v = ws[key].v.slice(0, -3) + "000";
    const r = readUpload(toBuffer(wb), "x.xlsx");
    expect(r.ok).toBe(false);
    const wb2 = buildSheetWorkbook(model());
    delete wb2.Sheets[CODES_SHEET];
    wb2.SheetNames = wb2.SheetNames.filter((n) => n !== CODES_SHEET);
    for (const key of Object.keys(wb2.Sheets["Rack 1"])) if (typeof wb2.Sheets["Rack 1"][key]?.v === "string" && wb2.Sheets["Rack 1"][key].v.startsWith("TS1.")) delete wb2.Sheets["Rack 1"][key];
    const r2 = readUpload(toBuffer(wb2), "x.xlsx");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/Rack 1 has no sheet code/);
  });

  it("racks from two different groups in one file are refused", () => {
    const a = buildSheetWorkbook(model());
    const other = { ...model(), groupId: uuid(2) };
    const b = buildSheetWorkbook(other);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, a.Sheets["Rack 1"], "Rack 1");
    XLSX.utils.book_append_sheet(wb, b.Sheets["Rack 2"], "Rack 2");
    const r = readUpload(toBuffer(wb), "x.xlsx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/different groups/);
  });

  it("a formula in a cell is read as the text it stored and is never run", () => {
    const wb = buildSheetWorkbook(model());
    const ws = wb.Sheets["Rack 1"];
    const range = XLSX.utils.decode_range(ws["!ref"]!);
    let header = 0;
    for (let r = 0; r <= range.e.r; r++) if (ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v === "Athlete") header = r;
    ws[XLSX.utils.encode_cell({ r: header + 2, c: 1 })] = { t: "n", v: 225, f: 'HYPERLINK("http://example.com","x")' };
    const r = readUpload(toBuffer(wb), "x.xlsx");
    expect(r.ok && r.racks[0].rows[0].cells[0][0]).toBe("225");
  });

  it("a very long text in a box is cut, not carried", () => {
    const wb = buildSheetWorkbook(model());
    fill(wb, 1, 0, 0, "9".repeat(5000));
    const r = readUpload(toBuffer(wb), "x.xlsx");
    expect(r.ok && r.racks[0].rows[0].cells[0][0].length).toBeLessThanOrEqual(120);
  });
});

describe("the review", () => {
  const sheetRacks = () => {
    const m = model();
    const wb = buildSheetWorkbook(m);
    fill(wb, 1, 0, 0, "225 235 245"); // Ann squat
    fill(wb, 1, 0, 1, "185x5 195x3"); // Ann bench: 185 for 5, 195 for 3
    fill(wb, 1, 0, 2, "10 10 8"); // Ann pull-up (reps only)
    fill(wb, 1, 0, 3, "45 sec"); // Ann plank (notes only)
    fill(wb, 1, 1, 0, "2?5 235"); // Bo squat: unsure
    fill(wb, 1, 1, 1, "-"); // Bo bench: skipped
    fill(wb, 2, 0, 0, "300"); // Cy squat
    const r = readUpload(toBuffer(wb), "x.xlsx");
    if (!r.ok) throw new Error(r.error);
    return { racks: r.racks, m };
  };

  it("reads every box by what its exercise records, and says what it made of it", () => {
    const { racks } = sheetRacks();
    const review = buildReview(G, racks, context(), "lb");
    const ann = review.sheets[0].rows[0];
    expect(ann.name).toBe("Ann A.");
    expect(ann.days[0][0].result.kind).toBe("sets");
    expect(ann.days[0][0].described).toBe("225 lb x 5, 235 lb x 5, 245 lb x 5 (reps from the sheet)");
    expect(ann.days[0][1].described).toBe("185 lb x 5, 195 lb x 3");
    // reps only: numbers are the reps of each set at body weight
    expect(ann.days[1][0].result).toMatchObject({ kind: "sets" });
    expect(ann.days[1][0].described).toBe("BW x 10, BW x 10, BW x 8");
    // a timed exercise keeps what was written as a note and reads nothing
    expect(ann.days[1][1].result.kind).toBe("unread");
    expect(ann.days[1][1].text).toBe("45 sec");
    const bo = review.sheets[0].rows[1];
    expect(bo.days[0][0].result.kind).toBe("unsure");
    expect(bo.days[0][1].result.kind).toBe("skipped");
    expect(review.summary.unsure).toBe(1);
  });

  it("flags an athlete who is not in the group any more, a name that no longer matches the seat, and who already has a session", () => {
    const { racks } = sheetRacks();
    const ctx = context({ roster: new Map([[uuid(11), "Ann Adams"], [uuid(13), "Cy Clark"], [uuid(12), "Robert Brown"]]), sessions: new Set([`${WORKOUT_MON}:${uuid(11)}`]) });
    const review = buildReview(G, racks, ctx, "lb");
    const rows = review.sheets[0].rows;
    expect(rows[0].existing).toEqual([true, false]);
    expect(rows[1].nameChanged).toBe(true);
    const gone = buildReview(G, racks, context({ roster: new Map([[uuid(11), "Ann Adams"], [uuid(13), "Cy Clark"]]) }), "lb");
    expect(gone.sheets[0].rows[1].gone).toBe(true);
    expect(gone.summary.gone).toBe(1);
  });

  it("an exercise that was removed from the workout is shown as removed and saves nothing", () => {
    const { racks } = sheetRacks();
    const ctx = context();
    ctx.exercises.delete(uuid(101));
    const review = buildReview(G, racks, ctx, "lb");
    expect(review.sheets[0].days[0].exercises[0]).toMatchObject({ missing: true, name: "(removed exercise)" });
    expect(review.sheets[0].rows[0].days[0][0].result.kind).toBe("missing");
    const { rows } = toSaveRows(review, "America/New_York");
    expect(JSON.stringify(rows)).not.toContain(uuid(101));
  });

  it("builds the rows the database function takes: one per athlete and workout, only the boxes that were understood", () => {
    const { racks } = sheetRacks();
    const review = buildReview(G, racks, context(), "lb");
    const { rows, droppedUnsure } = toSaveRows(review, "America/New_York");
    expect(droppedUnsure).toBe(1);
    const annMon = rows.find((r) => r.athlete_id === uuid(11) && r.workout_id === WORKOUT_MON)!;
    expect(Object.keys(annMon).sort()).toEqual(["at", "athlete_id", "day", "exercises", "workout_id"]);
    expect(annMon.day).toBe("2026-10-19");
    expect(annMon.at).toBe("2026-10-19T16:00:00.000Z"); // noon in New York (EDT)
    expect(annMon.exercises.map((e) => e.id)).toEqual([uuid(101), uuid(102)]);
    expect(annMon.exercises[0].sets).toEqual([{ weight: 225, reps: 5 }, { weight: 235, reps: 5 }, { weight: 245, reps: 5 }]);
    expect(annMon.exercises[1].sets).toEqual([{ weight: 185, reps: 5 }, { weight: 195, reps: 3 }]);
    const annWed = rows.find((r) => r.athlete_id === uuid(11) && r.workout_id === WORKOUT_WED)!;
    expect(annWed.exercises).toHaveLength(1); // the plank is a note, not a set
    expect(annWed.exercises[0].sets).toEqual([{ weight: null, reps: 10 }, { weight: null, reps: 10 }, { weight: null, reps: 8 }]);
    // Bo's squat was unsure and his bench skipped: Bo has no row at all
    expect(rows.some((r) => r.athlete_id === uuid(12))).toBe(false);
    // Cy
    // one bare number is every prescribed set at that weight
    expect(rows.find((r) => r.athlete_id === uuid(13))!.exercises[0].sets).toEqual([{ weight: 300, reps: 5 }, { weight: 300, reps: 5 }, { weight: 300, reps: 5 }]);
  });

  it("an athlete the coach turned off, or who is gone, is left out", () => {
    const { racks } = sheetRacks();
    const review = buildReview(G, racks, context(), "lb");
    const off = toSaveRows(review, "America/New_York", new Set([`1:${uuid(11)}`]));
    expect(off.rows.some((r) => r.athlete_id === uuid(11))).toBe(false);
    expect(off.rows.some((r) => r.athlete_id === uuid(13))).toBe(true);
    const gone = toSaveRows(buildReview(G, racks, context({ roster: new Map([[uuid(13), "Cy Clark"]]) }), "lb"), "America/New_York");
    expect(gone.rows.every((r) => r.athlete_id === uuid(13))).toBe(true);
  });

  it("the time zone puts the session on the right day (noon, so no zone can move it)", () => {
    const { racks } = sheetRacks();
    const review = buildReview(G, racks, context(), "lb");
    for (const tz of ["America/Los_Angeles", "Pacific/Auckland", "Asia/Tokyo", "UTC"]) {
      const at = toSaveRows(review, tz).rows[0].at;
      const day = toSaveRows(review, tz).rows[0].day;
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
      expect(local, tz).toBe(day);
    }
  });

  it("two workouts in one day become two rows, one per workout", () => {
    const m = model();
    m.days = [{ date: "2026-10-19", label: dayLabel("2026-10-19"), title: "x", exercises: [ex(1, "Back squat"), ex(3, "Pull-up")] }];
    m.mode = "day";
    const wb = buildSheetWorkbook(m);
    fill(wb, 1, 0, 0, "225");
    fill(wb, 1, 0, 1, "8 8");
    const r = readUpload(toBuffer(wb), "x.xlsx");
    if (!r.ok) throw new Error(r.error);
    const { rows } = toSaveRows(buildReview(G, r.racks, context(), "lb"), "America/New_York");
    const mine = rows.filter((x) => x.athlete_id === uuid(11));
    expect(mine.map((x) => x.workout_id).sort()).toEqual([WORKOUT_MON, WORKOUT_WED].sort());
  });

  it("the rows built here are exactly what the database rehearsal feeds the save function (one fixture, both sides)", () => {
    const { racks } = sheetRacks();
    const { rows } = toSaveRows(buildReview(G, racks, context(), "lb"), "America/New_York");
    // the ids are written as names so the rehearsal can put real ones in; the shape and the values are what matter
    const names: Record<string, string> = { [uuid(11)]: "@ANN", [uuid(12)]: "@BO", [uuid(13)]: "@CY", [WORKOUT_MON]: "@WORKOUT_MON", [WORKOUT_WED]: "@WORKOUT_WED", [uuid(101)]: "@EX_SQUAT", [uuid(102)]: "@EX_BENCH", [uuid(103)]: "@EX_PULLUP", [uuid(104)]: "@EX_PLANK" };
    const text = JSON.stringify(rows, null, 2).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => names[id] ?? id) + String.fromCharCode(10);
    const path = new URL("../../scripts/sql-tests/fixtures/team-sheet-save-rows.json", import.meta.url);
    if (process.env.WRITE_FIXTURE === "1") writeFileSync(path, text);
    expect(readFileSync(path, "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))).toBe(text);
  });

  it("the code that goes back with a save is the one printed", () => {
    const { racks, m } = sheetRacks();
    const review = buildReview(G, racks, context(), "lb");
    expect(review.sheets[0].codeText).toBe(encodeSheetCode(rackCode(m, m.racks[0])));
  });
});
