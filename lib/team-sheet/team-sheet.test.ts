import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import * as XLSX from "xlsx";
import { decodeSheetCode, encodeSheetCode, type SheetCode } from "@/lib/team-sheet/sheet-code";
import {
  MAX_COLUMNS_PER_PAGE,
  MAX_EXERCISES_PER_DAY,
  dayLabel,
  describePrescription,
  isDateKey,
  makeRacks,
  pageRack,
  shortName,
  weekDates,
  type SheetDay,
  type SheetExercise,
  type SheetModel,
} from "@/lib/team-sheet/sheet-model";
import { buildSheetXlsx, CODES_SHEET } from "@/lib/team-sheet/export-xlsx";
import { buildSheetPdf, rackCode } from "@/lib/team-sheet/export-pdf";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ex = (n: number, name = `Exercise ${n}`, extra: Partial<SheetExercise> = {}): SheetExercise => ({ id: uuid(1000 + n), name, prescription: "3x5", sets: 3, reps: 5, unread: false, ...extra });
const day = (date: string, n: number, title = "Lower A"): SheetDay => ({ date, label: dayLabel(date), title, exercises: Array.from({ length: n }, (_, i) => ex(i + 1 + Number(date.slice(-2)) * 100, `Exercise ${i + 1}`)) });
const athletes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: uuid(i + 1), fullName: `First${String.fromCharCode(65 + (i % 26))} Last${String(i).padStart(3, "0")}` }));
const model = (mode: "day" | "week", racksOf = 4, count = 9, days: SheetDay[] = mode === "day" ? [day("2026-10-21", 3)] : [day("2026-10-19", 3), day("2026-10-21", 4, "Upper"), day("2026-10-23", 3, "Lower B")]): SheetModel => ({
  groupId: uuid(9999),
  groupName: "Varsity Football",
  mode,
  unit: "lb",
  days,
  racks: makeRacks(athletes(count), racksOf),
});

describe("team sheet model", () => {
  it("names print as First L.", () => {
    expect(shortName("Marcus Taylor")).toBe("Marcus T.");
    expect(shortName("  Ana  de la Cruz ")).toBe("Ana C.");
    expect(shortName("Cher")).toBe("Cher");
    expect(shortName("")).toBe("Athlete");
    expect(shortName(null)).toBe("Athlete");
    expect(shortName("sam reyes")).toBe("sam R.");
  });

  it("racks are made in last-name order, the size asked for, the last rack short", () => {
    const racks = makeRacks(athletes(9), 4);
    expect(racks.map((r) => r.athletes.length)).toEqual([4, 4, 1]);
    expect(racks.map((r) => r.number)).toEqual([1, 2, 3]);
    const surnameOrder = racks.flatMap((r) => r.athletes.map((a) => a.id));
    expect(surnameOrder).toEqual(athletes(9).map((a) => a.id)); // Last000, Last001 ... are already in order
  });

  it("rack size is held between 1 and 6 whatever is asked", () => {
    expect(makeRacks(athletes(12), 100).map((r) => r.athletes.length)).toEqual([6, 6]);
    expect(makeRacks(athletes(3), 0).length).toBe(1);
    expect(makeRacks(athletes(5), NaN).map((r) => r.athletes.length)).toEqual([4, 1]);
    expect(makeRacks([], 4)).toEqual([]);
  });

  it("two people who would read the same get a number so a printed sheet is never ambiguous", () => {
    const racks = makeRacks([{ id: uuid(1), fullName: "Sam Reyes" }, { id: uuid(2), fullName: "Sam Rivera" }, { id: uuid(3), fullName: "Sam Rice" }], 4);
    expect(racks[0].athletes.map((a) => a.name).sort()).toEqual(["Sam R.", "Sam R. (2)", "Sam R. (3)"]);
  });

  it("sets and reps are described from the per-set rows when there are any", () => {
    expect(describePrescription({ prescribed_sets: 3, prescribed_reps: "5" })).toEqual({ text: "3x5", sets: 3, reps: 5 });
    expect(describePrescription({ prescribed_sets: 3, sets: [{ target_reps: "8" }, { target_reps: "8" }, { target_reps: "8" }, { target_reps: "8" }] })).toEqual({ text: "4x8", sets: 4, reps: 8 });
    expect(describePrescription({ sets: [{ target_reps: "5" }, { target_reps: "3" }, { target_reps: "1" }] })).toEqual({ text: "3x5/3/1", sets: 3, reps: null });
    expect(describePrescription({ prescribed_sets: 4, prescribed_reps: "8-10" })).toEqual({ text: "4x8-10", sets: 4, reps: null });
    expect(describePrescription({ prescribed_sets: 3, prescribed_reps: "AMRAP", load_note: "RPE 8" })).toEqual({ text: "3xAMRAP RPE 8", sets: 3, reps: null });
    expect(describePrescription({ prescribed_sets: 3 })).toEqual({ text: "3 sets", sets: 3, reps: null });
    expect(describePrescription({ prescribed_sets: 50, prescribed_reps: "5" }).sets).toBe(6); // never more boxes than fit
    expect(describePrescription({ prescribed_sets: null, prescribed_reps: "5" }).sets).toBe(3);
  });

  it("a week is Monday to Sunday whatever day is given", () => {
    for (const d of ["2026-10-19", "2026-10-21", "2026-10-25"]) expect(weekDates(d), d).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(weekDates("2026-11-01")[0]).toBe("2026-10-26"); // across a month end
    expect(weekDates("2027-01-01")[0]).toBe("2026-12-28"); // across a year end
    expect(dayLabel("2026-10-21")).toBe("Wed Oct 21");
  });

  it("only real calendar dates are dates", () => {
    expect(isDateKey("2026-10-21")).toBe(true);
    for (const v of ["2026-02-30", "2026-13-01", "26-10-21", "2026-10-21T00:00", "", null, 5, "2026-1-5"]) expect(isDateKey(v), String(v)).toBe(false);
  });

  it("pages: a day with too many exercises continues; a page holds a bounded number of columns and days", () => {
    expect(pageRack([day("2026-10-21", 3)]).length).toBe(1);
    const long = pageRack([day("2026-10-21", MAX_EXERCISES_PER_DAY + 6)]);
    expect(long.length).toBe(2);
    expect(long[1][0].offset).toBe(MAX_EXERCISES_PER_DAY);
    const week = pageRack([day("2026-10-19", 4), day("2026-10-20", 4), day("2026-10-21", 4), day("2026-10-22", 4)]);
    for (const page of week) {
      expect(page.length).toBeLessThanOrEqual(3);
      expect(page.reduce((s, b) => s + b.exercises.length, 0)).toBeLessThanOrEqual(MAX_COLUMNS_PER_PAGE);
    }
    // every exercise appears exactly once
    expect(week.flat().reduce((s, b) => s + b.exercises.length, 0)).toBe(16);
  });
});

describe("team sheet code", () => {
  const code: SheetCode = { v: 1, groupId: uuid(1), mode: "week", unit: "kg", rack: 3, days: [{ date: "2026-10-19", exercises: [uuid(10), uuid(11)] }, { date: "2026-10-21", exercises: [uuid(12)] }], athletes: [uuid(20), uuid(21), uuid(22)] };

  it("comes back exactly as it went in", () => {
    const r = decodeSheetCode(encodeSheetCode(code));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code).toEqual(code);
  });

  it("holds ids, never names", () => {
    const text = encodeSheetCode(code);
    expect(text).toMatch(/^TS1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    expect(Buffer.from(text.split(".")[1], "base64url").toString()).not.toMatch(/Marcus|Football/);
  });

  it("a changed or damaged code is refused, and so is anything that is not one", () => {
    const text = encodeSheetCode(code);
    const [a, b, c] = text.split(".");
    expect(decodeSheetCode(`${a}.${b.slice(0, -2)}AA.${c}`).ok).toBe(false);
    expect(decodeSheetCode(`${a}.${b}.00000000`).ok).toBe(false);
    for (const v of ["", "hello", null, undefined, 5, "TS1.", "TS1..", "TS2." + b + "." + c, text + "x", "TS1.@@@.00000000"]) expect(decodeSheetCode(v as any).ok, String(v)).toBe(false);
  });

  it("a code that checks out but says nonsense is refused (no days, no athletes, a bad id, too many)", () => {
    const sign = (obj: unknown) => {
      const b64 = Buffer.from(JSON.stringify(obj)).toString("base64url");
      return `TS1.${b64}.${createHash("sha256").update(b64).digest("hex").slice(0, 8)}`;
    };
    const h = (n: number) => uuid(n).replace(/-/g, "");
    const good = { v: 1, g: h(1), m: "d", u: "l", k: 1, d: [["2026-10-21", [h(2)]]], a: [h(3)] };
    expect(decodeSheetCode(sign(good)).ok).toBe(true);
    expect(decodeSheetCode(sign({ ...good, d: [] })).ok).toBe(false);
    expect(decodeSheetCode(sign({ ...good, a: [] })).ok).toBe(false);
    expect(decodeSheetCode(sign({ ...good, g: "nope" })).ok).toBe(false);
    expect(decodeSheetCode(sign({ ...good, k: 0 })).ok).toBe(false);
    expect(decodeSheetCode(sign({ ...good, m: "x" })).ok).toBe(false);
    expect(decodeSheetCode(sign({ ...good, d: [["not a date", [h(2)]]] })).ok).toBe(false);
    expect(decodeSheetCode(sign({ ...good, a: Array.from({ length: 13 }, (_, i) => h(i + 1)) })).ok).toBe(false);
    expect(decodeSheetCode(sign({ ...good, d: [["2026-10-21", Array.from({ length: 41 }, (_, i) => h(i + 1))]] })).ok).toBe(false);
  });

  it("the fullest sheet still fits in a QR code", () => {
    const full: SheetCode = { ...code, days: Array.from({ length: 4 }, (_, i) => ({ date: `2026-10-2${i}`, exercises: Array.from({ length: 10 }, (_, j) => uuid(100 + i * 10 + j)) })), athletes: Array.from({ length: 6 }, (_, i) => uuid(i + 1)) };
    expect(encodeSheetCode(full).length).toBeLessThan(2400);
  });
});

describe("team sheet Excel file", () => {
  const read = (m: SheetModel) => XLSX.read(buildSheetXlsx(m), { type: "buffer" });
  const cells = (ws: XLSX.WorkSheet) => XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];

  it("has one worksheet per rack and a hidden one for the codes", () => {
    const wb = read(model("day", 4, 9));
    expect(wb.SheetNames).toEqual(["Rack 1", "Rack 2", "Rack 3", CODES_SHEET]);
    expect(wb.Workbook?.Sheets?.find((s) => s.name === CODES_SHEET)?.Hidden).toBe(1);
    expect(wb.Workbook?.Sheets?.filter((s) => s.Hidden).length).toBe(1);
  });

  it("the codes sheet carries a readable code for every rack, matching the rack", () => {
    const m = model("week", 4, 9);
    const rows = cells(read(m).Sheets[CODES_SHEET]);
    expect(rows[0][0]).toBe("rack");
    expect(rows.length).toBe(1 + m.racks.length);
    m.racks.forEach((rk, i) => {
      const dec = decodeSheetCode(rows[i + 1][1]);
      expect(dec.ok).toBe(true);
      if (dec.ok) expect(dec.code).toEqual(rackCode(m, rk));
    });
  });

  it("a day sheet: title, instructions, exercise names, prescriptions, one row per athlete with First L. names", () => {
    const m = model("day", 4, 6);
    const rows = cells(read(m).Sheets["Rack 1"]);
    const flat = rows.flat().join("|");
    expect(rows[0][0]).toBe("Rack 1 - Wed Oct 21 - Lower A");
    expect(flat).toContain("weights in lb");
    expect(flat).toContain("Timed or distance work");
    expect(flat).toContain("Exercise 1");
    expect(flat).toContain("3x5");
    for (const a of m.racks[0].athletes) expect(flat).toContain(a.name);
    expect(flat).not.toContain("Last00"); // surnames are initials only
    const header = rows.find((r) => r[0] === "Athlete")!;
    expect(header[header.length - 1]).toBe("Notes");
  });

  it("a week sheet has a band for each training day", () => {
    const wb = read(model("week", 4, 5));
    const flat = cells(wb.Sheets["Rack 1"]).flat().join("|");
    expect(flat).toContain("Mon Oct 19 - Lower A");
    expect(flat).toContain("Wed Oct 21 - Upper");
    expect(flat).toContain("Fri Oct 23 - Lower B");
    expect((wb.Sheets["Rack 1"]["!merges"] ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("a timed exercise says so instead of a prescription", () => {
    const m = model("day", 4, 4, [{ ...day("2026-10-21", 2), exercises: [ex(1, "Plank", { unread: true, sets: 0 }), ex(2)] }]);
    expect(cells(read(m).Sheets["Rack 1"]).flat().join("|")).toContain("timed: use Notes");
  });

  it("builds a large roster without trouble", () => {
    const wb = read(model("week", 4, 200));
    expect(wb.SheetNames.length).toBe(51);
  });
});

describe("team sheet PDF", () => {
  // the page contents are compressed: the readable text is the file structure followed by every page stream, inflated
  const text = (b: Buffer) => {
    const s = b.toString("latin1");
    const parts: string[] = [s];
    for (const m of s.matchAll(/stream\n([\s\S]*?)\nendstream/g)) parts.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"));
    return parts.join("\n");
  };

  it("is a real PDF with one page per rack", () => {
    const b = buildSheetPdf(model("day", 4, 9));
    const t = text(b);
    expect(t.startsWith("%PDF-1.4")).toBe(true);
    expect(b.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
    expect(t.match(/\/Type \/Page /g)?.length).toBe(3);
    expect(t).toContain("/Count 3");
  });

  it("each page says which rack, the day, the exercises, the instructions and who is on it", () => {
    const m = model("day", 4, 6);
    const t = text(buildSheetPdf(m));
    expect(t).toContain("Rack 1  -  Wed Oct 21  -  Lower A");
    expect(t).toContain("Rack 2");
    expect(t).toContain("Exercise 1");
    expect(t).toContain("How to fill this in");
    expect(t).toContain("Timed or distance work");
    expect(t).toContain("weights in lb");
    for (const a of m.racks[1].athletes) expect(t).toContain(a.name);
    expect(t).toContain("sheet code");
  });

  it("a week sheet puts the days side by side with their bands", () => {
    const t = text(buildSheetPdf(model("week", 4, 4)));
    expect(t).toContain("Week of Mon Oct 19");
    expect(t).toContain("Mon Oct 19");
    expect(t).toContain("Wed Oct 21");
    expect(t).toContain("Fri Oct 23");
  });

  it("a long week continues on further pages for the same rack", () => {
    const days = [day("2026-10-19", 11), day("2026-10-21", 8), day("2026-10-23", 8)];
    const t = text(buildSheetPdf(model("week", 4, 4, days)));
    expect(t.match(/\/Type \/Page /g)?.length).toBeGreaterThan(1);
    expect(t).toContain("part 2 of");
    expect(t).toContain("\\(cont.\\)");
  });

  it("draws the code as a QR (many small squares) and the set boxes", () => {
    const t = text(buildSheetPdf(model("day", 4, 4)));
    expect((t.match(/ re f/g) ?? []).length).toBeGreaterThan(100);
    expect((t.match(/ re S/g) ?? []).length).toBeGreaterThan(30);
  });

  it("a name or exercise with characters the PDF cannot hold does not break it", () => {
    const m = model("day", 4, 2, [{ ...day("2026-10-21", 1), exercises: [ex(1, "Snatch – hang (power) \\ 中文")] }]);
    m.racks[0].athletes[0].name = "Renée (O’Neil) 中.";
    const t = text(buildSheetPdf(m));
    expect(t.startsWith("%PDF")).toBe(true);
    expect(t).toContain("Renée \\(O");
  });

  it("an enormous roster and week stays reasonable", () => {
    const started = Date.now();
    const b = buildSheetPdf(model("week", 4, 200));
    expect(b.length).toBeLessThan(8_000_000);
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
