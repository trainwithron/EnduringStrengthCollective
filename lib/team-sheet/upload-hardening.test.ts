import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildSheetWorkbook } from "@/lib/team-sheet/export-xlsx";
import { MAX_UNPACKED_BYTES, MAX_ZIP_ENTRIES, readUpload, unplain, zipLooksSafe } from "@/lib/team-sheet/read-upload";
import { alignRack, buildReview, commonUnit, type Context } from "@/lib/team-sheet/review";
import { readBox } from "@/lib/team-sheet/cell-parser";
import { toSaveRows } from "@/lib/team-sheet/review";
import { dayLabel, makeRacks, type SheetExercise, type SheetModel } from "@/lib/team-sheet/sheet-model";

// sheet codes carry real dates and the reader refuses a day more than a day ahead or two years back, so these tests run on a fixed clock
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const G = uuid(1);
const MON = uuid(50);
const ex = (n: number, name: string): SheetExercise => ({ id: uuid(100 + n), name, prescription: "3x5", sets: 3, reps: 5, unread: false });

function model(athletes: { id: string; fullName: string }[] = [{ id: uuid(11), fullName: "Ann Adams" }, { id: uuid(12), fullName: "Bo Brown" }, { id: uuid(13), fullName: "Cy Clark" }]): SheetModel {
  return { groupId: G, groupName: "Team", mode: "day", unit: "lb", days: [{ date: "2026-10-05", label: dayLabel("2026-10-05"), title: "Lower", exercises: [ex(1, "Back squat"), ex(2, "Bench press")] }], racks: makeRacks(athletes, 8) };
}
function context(roster: [string, string][]): Context {
  const g = (n: number, name: string) => [uuid(100 + n), { id: uuid(100 + n), workout_id: MON, exercise_name: name, display_name: null, tracked_fields: ["reps", "weight"] as string[], group_workout_exercise_sets: [1, 2, 3].map((i) => ({ set_order: i, target_reps: "5" })) }] as [string, any];
  return { exercises: new Map([g(1, "Back squat"), g(2, "Bench press")]), workoutTitles: new Map([[MON, "Lower"]]), roster: new Map(roster), sessions: new Set<string>() };
}
const headerRow = (ws: XLSX.WorkSheet) => {
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let r = 0; r <= range.e.r; r++) if (ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v === "Athlete") return r;
  throw new Error("no header");
};
const put = (wb: XLSX.WorkBook, i: number, c: number, cell: XLSX.CellObject) => {
  const ws = wb.Sheets["Rack 1"];
  ws[XLSX.utils.encode_cell({ r: headerRow(ws) + 2 + i, c: 1 + c })] = cell;
};
const toBuffer = (wb: XLSX.WorkBook) => Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

// a zip that is only a directory: enough for the guard, which reads nothing else
function fakeZip(sizes: number[]): Buffer {
  const entries = sizes.map((size) => {
    const b = Buffer.alloc(46);
    b.writeUInt32LE(0x02014b50, 0);
    b.writeUInt32LE(size, 24);
    return b;
  });
  const dir = Buffer.concat(entries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(sizes.length, 8);
  eocd.writeUInt16LE(sizes.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([dir, eocd]);
}

describe("an .xlsx that unpacks to far more than it weighs", () => {
  it("is refused before anything is unpacked", () => {
    expect(zipLooksSafe(fakeZip([1000, 2000]))).toBe(true);
    expect(zipLooksSafe(fakeZip([MAX_UNPACKED_BYTES + 1]))).toBe(false);
    expect(zipLooksSafe(fakeZip([MAX_UNPACKED_BYTES / 2, MAX_UNPACKED_BYTES / 2 + 10]))).toBe(false);
    expect(zipLooksSafe(fakeZip(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, () => 10)))).toBe(false);
    expect(zipLooksSafe(fakeZip([0xffffffff]))).toBe(false);
    expect(zipLooksSafe(Buffer.from("PK not really a zip"))).toBe(false);
    const r = readUpload(fakeZip([300 * 1024 * 1024]), "bomb.xlsx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/larger inside/);
  });

  it("a real team sheet passes the guard", () => {
    expect(zipLooksSafe(toBuffer(buildSheetWorkbook(model())))).toBe(true);
    expect(readUpload(toBuffer(buildSheetWorkbook(model())), "s.xlsx").ok).toBe(true);
  });
});

describe("what a box can hold that is not a weight", () => {
  it("an error cell is read as its error text, never as the number code behind it", () => {
    const wb = buildSheetWorkbook(model());
    put(wb, 0, 0, { t: "e", v: 7, w: "#DIV/0!" });
    const r = readUpload(toBuffer(wb), "s.xlsx");
    expect(r.ok && r.racks[0].rows[0].cells[0][0]).toMatch(/^#/);
    expect(r.ok && r.racks[0].rows[0].cells[0][0]).not.toBe("7");
  });

  it("a number the file shows as a time or a percent is read as shown, not as the raw fraction", () => {
    const wb = buildSheetWorkbook(model());
    put(wb, 0, 0, { t: "n", v: 0.0625, z: "h:mm" });
    put(wb, 1, 0, { t: "n", v: 0.5, z: "0%" });
    put(wb, 2, 0, { t: "n", v: 225, z: "0.0" });
    const r = readUpload(toBuffer(wb), "s.xlsx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.racks[0].rows[0].cells[0][0]).toBe("1:30");
    expect(r.racks[0].rows[1].cells[0][0]).toBe("50%");
    expect(r.racks[0].rows[2].cells[0][0]).toBe("225");
    // none of the first two is a weight
    expect(readBox("load", "1:30", { unit: "lb", sets: 3, reps: 5 }).kind).toBe("unsure");
    expect(readBox("load", "50%", { unit: "lb", sets: 3, reps: 5 }).kind).toBe("unsure");
  });

  it("in a CSV the boxes stay the text they are: set separators are not dates, a time is not a fraction", () => {
    const wb = buildSheetWorkbook(model());
    put(wb, 0, 0, { t: "s", v: "225/235/245" });
    put(wb, 0, 1, { t: "s", v: "5-3" });
    put(wb, 1, 0, { t: "s", v: "2:30" });
    put(wb, 1, 1, { t: "s", v: "1e3" });
    put(wb, 2, 0, { t: "s", v: "(225)" });
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets["Rack 1"]);
    const r = readUpload(Buffer.from(csv, "utf8"), "s.csv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.racks[0].rows[0].cells[0]).toEqual(["225/235/245", "5-3"]);
    expect(r.racks[0].rows[1].cells[0]).toEqual(["2:30", "1e3"]);
    expect(r.racks[0].rows[2].cells[0][0]).toBe("(225)");
  });

  it("a CSV saved by Excel on Windows (not UTF-8) keeps its accents, so a name does not look changed", () => {
    const m = model([{ id: uuid(11), fullName: "José Adams" }, { id: uuid(12), fullName: "Bo Brown" }]);
    const wb = buildSheetWorkbook(m);
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets["Rack 1"]);
    const latin1 = Buffer.from(csv, "latin1");
    const r = readUpload(latin1, "s.csv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.racks[0].rows.map((x) => x.printedName)).toContain("José A.");
  });

  it("a weight under 1 and a body-weight box with no reps anywhere are not read as sets", () => {
    expect(readBox("load", "0.5", { unit: "lb", sets: 3, reps: 5 }).kind).toBe("unsure");
    expect(readBox("load", "BW", { unit: "lb", sets: 3, reps: null }).kind).toBe("unsure");
    expect(readBox("load", "BW", { unit: "lb", sets: 3, reps: 8 }).kind).toBe("sets");
  });
});

describe("names and columns on the sheet", () => {
  it("a name the export protected with an apostrophe reads back as the name", () => {
    expect(unplain("'-Bob C.")).toBe("-Bob C.");
    expect(unplain("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(unplain("O'Neil")).toBe("O'Neil");
    expect(unplain("'plain")).toBe("'plain");
    const m = model([{ id: uuid(11), fullName: "-Bob Cole" }, { id: uuid(12), fullName: "Bo Brown" }]);
    const r = readUpload(toBuffer(buildSheetWorkbook(m)), "s.xlsx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const review = buildReview(G, r.racks, context([[uuid(11), "-Bob Cole"], [uuid(12), "Bo Brown"]]), "lb");
    expect(review.sheets[0].rows.every((row) => !row.nameChanged)).toBe(true);
  });

  const roster = (): [string, string][] => [[uuid(11), "Ann Adams"], [uuid(12), "Bo Brown"], [uuid(13), "Cy Clark"]];
  const filled = () => {
    const wb = buildSheetWorkbook(model());
    put(wb, 0, 0, { t: "s", v: "100" });
    put(wb, 1, 0, { t: "s", v: "200" });
    put(wb, 2, 0, { t: "s", v: "300" });
    const r = readUpload(toBuffer(wb), "s.xlsx");
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("a sheet re-sorted in Excel keeps each name with its own boxes: Bo's 200 is saved to Bo, not to whoever is in that row now", () => {
    const r = filled();
    const rack = r.racks[0];
    const reordered = { ...rack, rows: [rack.rows[2], rack.rows[0], rack.rows[1]] }; // Cy, Ann, Bo
    const review = buildReview(G, [reordered], context(roster()), "lb");
    const byId = new Map(review.sheets[0].rows.map((row) => [row.athleteId, row]));
    expect(byId.get(uuid(11))!.days[0][0].text).toBe("100");
    expect(byId.get(uuid(12))!.days[0][0].text).toBe("200");
    expect(byId.get(uuid(13))!.days[0][0].text).toBe("300");
    expect(review.sheets[0].rows.map((row) => row.athleteId)).toEqual([uuid(11), uuid(12), uuid(13)]);
    expect(review.sheets[0].rows.every((row) => !row.nameChanged)).toBe(true);
  });

  it("a name that is nobody's on the rack stays where it is and is flagged, so it is left out until the coach ticks it in", () => {
    const r = filled();
    const rack = r.racks[0];
    const rows = rack.rows.map((row, i) => (i === 1 ? { ...row, printedName: "Zed Z." } : row));
    const review = buildReview(G, [{ ...rack, rows }], context(roster()), "lb");
    expect(review.sheets[0].rows.map((row) => row.nameChanged)).toEqual([false, true, false]);
  });

  it("two rows claiming the same athlete move nobody and flag the strays", () => {
    const rack = filled().racks[0];
    const rows = rack.rows.map((row, i) => (i === 2 ? { ...row, printedName: "Ann A." } : row)); // Cy's row now says Ann
    const out = alignRack({ ...rack, rows }, new Map(roster()));
    expect(out.flagged.has(uuid(13))).toBe(true);
    expect(out.rack.rows[0].cells[0][0]).toBe("100");
  });

  it("two athletes with the same short name: swapping their rows is flagged", () => {
    const m = model([{ id: uuid(11), fullName: "Sam Reed" }, { id: uuid(12), fullName: "Sam Rogers" }]);
    const wb = buildSheetWorkbook(m);
    const r = readUpload(toBuffer(wb), "s.xlsx");
    if (!r.ok) throw new Error(r.error);
    const rack = r.racks[0];
    expect(rack.rows.map((x) => x.printedName)).toEqual(["Sam R.", "Sam R. (2)"]);
    const ctx = context([[uuid(11), "Sam Reed"], [uuid(12), "Sam Rogers"]]);
    expect(buildReview(G, [rack], ctx, "lb").sheets[0].rows.map((row) => row.nameChanged)).toEqual([false, false]);
    const swapped = { ...rack, rows: [rack.rows[1], rack.rows[0]] };
    expect(buildReview(G, [swapped], ctx, "lb").sheets[0].rows.map((row) => row.nameChanged)).toEqual([true, true]);
  });

  it("rows that come back from the browser (no printed names) are left exactly as they are", () => {
    const rack = filled().racks[0];
    const bare = { ...rack, rows: rack.rows.map((row) => ({ ...row, printedName: "" })) };
    const out = alignRack(bare, new Map(roster()));
    expect(out.flagged.size).toBe(0);
    expect(out.rack).toBe(bare);
  });

  it("a header row that is not the sheet's exercises means the columns moved", () => {
    const wb = buildSheetWorkbook(model());
    const ws = wb.Sheets["Rack 1"];
    const same = readUpload(toBuffer(wb), "s.xlsx");
    if (!same.ok) throw new Error(same.error);
    expect(buildReview(G, same.racks, context(roster()), "lb").sheets[0].columnsChanged).toBe(false);
    ws[XLSX.utils.encode_cell({ r: headerRow(ws), c: 1 })] = { t: "s", v: "Deadlift" };
    const moved = readUpload(toBuffer(wb), "s.xlsx");
    if (!moved.ok) throw new Error(moved.error);
    expect(buildReview(G, moved.racks, context(roster()), "lb").sheets[0].columnsChanged).toBe(true);
  });

  it("sheets of the file in different units have no common unit", () => {
    expect(commonUnit([{ code: { unit: "lb" } as any }, { code: { unit: "lb" } as any }])).toBe("lb");
    expect(commonUnit([{ code: { unit: "lb" } as any }, { code: { unit: "kg" } as any }])).toBeNull();
  });
});

describe("the file as a whole", () => {
  it("tabs that are not rack sheets are named, not silently dropped", () => {
    const wb = buildSheetWorkbook(model());
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["my notes"]]), "Coach notes");
    const r = readUpload(toBuffer(wb), "s.xlsx");
    expect(r.ok && r.ignoredSheets).toEqual(["Coach notes"]);
  });

  it("only the team's own exercises are read when a sheet is reviewed", () => {
    expect(readFileSync("lib/team-sheet/review.ts", "utf8")).toMatch(/\.eq\("group_id", groupId\)\.is\("athlete_id", null\)\.in\("id", ids\)/);
  });
});

describe("a sheet printed in kilograms", () => {
  const kgReview = () => {
    const m = { ...model(), unit: "kg" as const };
    const wb = buildSheetWorkbook(m);
    put(wb, 0, 0, { t: "s", v: "100 100 90" });
    put(wb, 1, 0, { t: "s", v: "132.5x3" });
    put(wb, 2, 0, { t: "s", v: "950" });
    const r = readUpload(toBuffer(wb), "s.xlsx");
    if (!r.ok) throw new Error(r.error);
    return buildReview(G, r.racks, context([[uuid(11), "Ann Adams"], [uuid(12), "Bo Brown"], [uuid(13), "Cy Clark"]]), "kg");
  };
  it("is saved in pounds: 100 kg is stored as 220.46, whoever lifted it", () => {
    const { rows } = toSaveRows(kgReview(), "America/New_York");
    const ann = rows.find((r) => r.athlete_id === uuid(11))!;
    expect(ann.exercises[0].sets.map((s) => s.weight)).toEqual([220.46, 220.46, 198.42]);
    const bo = rows.find((r) => r.athlete_id === uuid(12))!;
    expect(bo.exercises[0].sets).toEqual([{ weight: 292.11, reps: 3 }]);
  });
  it("a weight no one lifts in kilograms is not sure, so it can never turn into more than the database allows", () => {
    expect(kgReview().sheets[0].rows.find((r) => r.athleteId === uuid(13))!.days[0][0].result.kind).toBe("unsure");
    expect(readBox("load", "899", { unit: "kg", sets: 3, reps: 5 }).kind).toBe("sets");
  });
  it("a sheet in pounds is saved exactly as written", () => {
    const wb = buildSheetWorkbook(model());
    put(wb, 0, 0, { t: "s", v: "225 235" });
    const r = readUpload(toBuffer(wb), "s.xlsx");
    if (!r.ok) throw new Error(r.error);
    const { rows } = toSaveRows(buildReview(G, r.racks, context([[uuid(11), "Ann Adams"], [uuid(12), "Bo Brown"], [uuid(13), "Cy Clark"]]), "lb"), "America/New_York");
    expect(rows[0].exercises[0].sets.map((s) => s.weight)).toEqual([225, 235]);
  });
});
