import { describe, expect, it } from "vitest";
import { cellFromBoxes, matchColumns, mergeRacks, normName, parsePhotoReading, photoUserText, rackFromPhoto, UNCLEAR_CELL, type PhotoReading } from "@/lib/team-sheet/photo-read";
import { codeRegions, decodeScale, MAX_DECODE_EDGE } from "@/lib/team-sheet/photo-code";
import type { SheetCode } from "@/lib/team-sheet/sheet-code";
import { readBox } from "@/lib/team-sheet/cell-parser";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const code: SheetCode = {
  v: 1,
  groupId: uuid(1),
  mode: "week",
  unit: "lb",
  rack: 1,
  days: [
    { date: "2026-10-19", exercises: [uuid(101), uuid(102)] },
    { date: "2026-10-21", exercises: [uuid(103)] },
  ],
  athletes: [uuid(11), uuid(12)],
};
const names = new Map([
  [uuid(101), "Back Squat"],
  [uuid(102), "Romanian Deadlift"],
  [uuid(103), "Bench Press"],
]);
const sure = (text: string) => ({ text, sure: true });
const reading = (over: Partial<PhotoReading> = {}): PhotoReading => ({
  columns: ["Back Squat", "Romanian Deadl...", "Bench Press"],
  rows: [
    { name: "Ann A.", cells: [[sure("225x5"), sure("235x5")], [sure("135")], [sure("185x5")]], notes: sure("felt good") },
    { name: "Bo B.", cells: [[sure("300"), { text: "3l5", sure: false }], [sure("")], [sure("BW")]], notes: { text: "smudge", sure: false } },
  ],
  ...over,
});

describe("reading the model's reply", () => {
  it("an error reply, or anything not shaped like a reading, is refused with a plain reason", () => {
    expect(parsePhotoReading({ error: "not a team sheet" })).toEqual({ ok: false, error: "The photo could not be read as a team sheet: not a team sheet" });
    expect(parsePhotoReading({ columns: "x" }).ok).toBe(false);
    expect(parsePhotoReading(null).ok).toBe(false);
  });

  it("a box is only sure when the model said so, and a box longer than a box can hold is never sure", () => {
    const r = parsePhotoReading({ columns: ["A"], rows: [{ name: "Ann", cells: [[{ text: "225", sure: true }, { text: "225", sure: "yes" }, { text: "x".repeat(40), sure: true }, { text: 135 }]], notes: {} }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reading.rows[0].cells[0].map((b) => b.sure)).toEqual([true, false, false, false]);
    expect(r.reading.rows[0].cells[0][3].text).toBe("135");
  });

  it("the words sent with the photo name the sheet's own exercises in order and how many rows it has", () => {
    const t = photoUserText(code, names);
    expect(t).toContain("2 athlete rows");
    expect(t.indexOf("Back Squat")).toBeLessThan(t.indexOf("Romanian Deadlift"));
    expect(t.indexOf("Romanian Deadlift")).toBeLessThan(t.indexOf("Bench Press"));
  });
});

describe("matching the page's columns to the sheet code", () => {
  it("names are compared without case or punctuation, and a name cut short on the paper matches the full one", () => {
    expect(normName("Romanian Deadl…")).toBe("romaniandeadl");
    expect(matchColumns(["back squat", "Romanian Deadl…"], ["Back Squat", "Romanian Deadlift", "Bench Press"])).toBe(0);
    expect(matchColumns(["Bench Press"], ["Back Squat", "Romanian Deadlift", "Bench Press"])).toBe(2);
  });

  it("no match, or the same names at two places (which one is it?), is refused, never guessed", () => {
    expect(matchColumns(["Deadlift"], ["Back Squat", "Bench Press"])).toBeNull();
    expect(matchColumns(["Back Squat"], ["Back Squat", "Bench Press", "Back Squat"])).toBeNull();
    expect(matchColumns([], ["Back Squat"])).toBeNull();
    // a very short cut-off is not enough to match on
    expect(matchColumns(["Ba"], ["Back Squat"])).toBeNull();
  });
});

describe("boxes into cells", () => {
  it("the boxes written in a cell are joined; an empty cell is empty; any box not read with certainty makes the whole cell '?'", () => {
    expect(cellFromBoxes([sure("225x5"), sure(""), sure("235x3")])).toEqual({ text: "225x5 235x3", unclear: false });
    expect(cellFromBoxes([sure(""), sure("")])).toEqual({ text: "", unclear: false });
    expect(cellFromBoxes([sure("225x5"), { text: "2?5", sure: false }])).toEqual({ text: UNCLEAR_CELL, unclear: true });
  });

  it("a '?' cell is read by the review as unsure: highlighted and never saved as it is", () => {
    expect(readBox("load", UNCLEAR_CELL, { unit: "lb", sets: 3, reps: 5 }).kind).toBe("unsure");
    expect(readBox("reps", UNCLEAR_CELL, { unit: "lb", sets: 3, reps: 5 }).kind).toBe("unsure");
  });
});

describe("a page into the rack its code names", () => {
  it("rows in the code's order with their printed names, columns where the code puts them, unsure boxes as '?'", () => {
    const r = rackFromPhoto(code, names, reading());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unclear).toBe(1);
    expect(r.rack.rows.map((row) => [row.athleteId, row.printedName])).toEqual([
      [uuid(11), "Ann A."],
      [uuid(12), "Bo B."],
    ]);
    expect(r.rack.rows[0].cells).toEqual([["225x5 235x5", "135"], ["185x5"]]);
    expect(r.rack.rows[1].cells).toEqual([[UNCLEAR_CELL, ""], ["BW"]]);
    // a note is kept only when read with certainty
    expect(r.rack.rows[0].notes).toBe("felt good");
    expect(r.rack.rows[1].notes).toBe("");
  });

  it("a page showing only some of the columns fills those and leaves the rest empty", () => {
    const r = rackFromPhoto(code, names, reading({ columns: ["Bench Press"], rows: reading().rows.map((row) => ({ ...row, cells: [row.cells[2]] })) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rack.rows[0].cells).toEqual([["", ""], ["185x5"]]);
  });

  it("refused: names that are not this sheet's, or a different number of rows than the sheet was printed with", () => {
    const wrong = rackFromPhoto(code, names, reading({ columns: ["Deadlift", "Row", "Press"] }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/don't match the sheet/);
    const short = rackFromPhoto(code, names, reading({ rows: reading().rows.slice(0, 1) }));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/printed with 2 athlete rows, and 1 could be read/);
  });
});

describe("several photos in one review", () => {
  it("two pages of the same rack are one rack; the same cell read differently on two photos is '?'", () => {
    const a = rackFromPhoto(code, names, reading({ columns: ["Back Squat", "Romanian Deadlift"], rows: reading().rows.map((row) => ({ ...row, cells: row.cells.slice(0, 2) })) }));
    const b = rackFromPhoto(code, names, reading({ columns: ["Romanian Deadlift", "Bench Press"], rows: reading().rows.map((row, i) => ({ ...row, cells: [i === 0 ? [sure("145")] : row.cells[1], row.cells[2]] })) }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const merged = mergeRacks([a.rack, b.rack]);
    expect(merged).toHaveLength(1);
    expect(merged[0].rows[0].cells).toEqual([["225x5 235x5", UNCLEAR_CELL], ["185x5"]]);
    expect(merged[0].rows[1].cells).toEqual([[UNCLEAR_CELL, ""], ["BW"]]);
    // the first photo's rack is not changed by merging
    expect(a.rack.rows[0].cells[0][1]).toBe("135");
  });

  it("different racks stay apart", () => {
    const a = rackFromPhoto(code, names, reading());
    const b = rackFromPhoto({ ...code, rack: 2 }, names, reading());
    if (!a.ok || !b.ok) throw new Error("read");
    expect(mergeRacks([a.rack, b.rack]).map((r) => r.code.rack)).toEqual([1, 2]);
  });
});

describe("finding the sheet code in a photo", () => {
  it("the whole photo first, then the bottom right corner (where the code is printed), generously, then the other corner for a photo taken upside down", () => {
    const r = codeRegions(4000, 3000);
    expect(r[0]).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
    expect(r[1]).toEqual({ x: 2600, y: 1650, width: 1400, height: 1350 });
    expect(r[1].x + r[1].width).toBe(4000);
    expect(r[1].y + r[1].height).toBe(3000);
    expect(r[3]).toMatchObject({ x: 0, y: 0 });
    expect(codeRegions(0, 10)).toEqual([]);
  });

  it("a crop is decoded at the photo's own size; only a region larger than the limit is shrunk", () => {
    expect(decodeScale({ x: 0, y: 0, width: 1400, height: 1350 })).toBe(1);
    expect(decodeScale({ x: 0, y: 0, width: 4800, height: 3600 })).toBe(MAX_DECODE_EDGE / 4800);
  });
});

describe("section labels on the printed sheet", () => {
  it("the model is told a small capitalised section word above a name is not part of the name", async () => {
    const { TEAM_SHEET_PHOTO_PROMPT } = await import("@/lib/team-sheet/photo-read");
    expect(TEAM_SHEET_PHOTO_PROMPT).toContain("A small capitalised section word printed above an exercise name (WARM-UP, STRENGTH, CONDITIONING) is a section label: it is not part of the name");
  });
  it("and if one is read into a name anyway, the page is refused, never matched to the wrong column", () => {
    expect(matchColumns(["STRENGTH Back Squat", "Bench Press"], ["Back Squat", "Bench Press"])).toBeNull();
  });
});
