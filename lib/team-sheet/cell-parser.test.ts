import { describe, expect, it } from "vitest";
import { describeCell, parseCell, MAX_SETS, type ParsedCell } from "@/lib/team-sheet/cell-parser";

const rx = { sets: 3, reps: 5 };
const sets = (c: ParsedCell) => (c.kind === "sets" ? c.sets.map((s) => [s.weight, s.reps, s.repsAssumed]) : c.kind);

describe("team sheet cell reader: nothing, or left out on purpose", () => {
  it("nothing written is empty", () => {
    for (const v of ["", " ", "   ", "\n", "\t", null, undefined, " "]) expect(parseCell(v), JSON.stringify(v)).toEqual({ kind: "empty" });
  });
  it("a dash, X, DNS, skip, n/a and the like are skipped, never zero", () => {
    for (const v of ["-", "--", "–", "—", "x", "X", "DNS", "dns", "skip", "Skipped", "n/a", "NA", "out", "None", " - "]) expect(parseCell(v), v).toEqual({ kind: "skipped" });
  });
});

describe("team sheet cell reader: weights", () => {
  it("several weights are several sets, at the prescribed reps", () => {
    expect(sets(parseCell("225 235 245", { prescribed: rx }))).toEqual([[225, 5, true], [235, 5, true], [245, 5, true]]);
  });
  it("a comma, slash or semicolon separates sets just like a space", () => {
    for (const v of ["225,235,245", "225, 235, 245", "225/235/245", "225;235;245", "225  235   245"]) expect(sets(parseCell(v, { prescribed: rx })), v).toEqual([[225, 5, true], [235, 5, true], [245, 5, true]]);
  });
  it("weight x reps pairs say their own reps", () => {
    expect(sets(parseCell("225x5 235x3", { prescribed: rx }))).toEqual([[225, 5, false], [235, 3, false]]);
    expect(sets(parseCell("225 x 5, 235 x 3", { prescribed: rx }))).toEqual([[225, 5, false], [235, 3, false]]);
    expect(sets(parseCell("225×5 235×3"))).toEqual([[225, 5, false], [235, 3, false]]);
    expect(sets(parseCell("225X5"))).toEqual([[225, 5, false]]);
  });
  it("weight x reps x sets repeats the set", () => {
    expect(sets(parseCell("225x5x3"))).toEqual([[225, 5, false], [225, 5, false], [225, 5, false]]);
    expect(sets(parseCell("225x5x2 235x3"))).toEqual([[225, 5, false], [225, 5, false], [235, 3, false]]);
  });
  it("one bare number means every prescribed set at that weight", () => {
    expect(sets(parseCell("185", { prescribed: rx }))).toEqual([[185, 5, true], [185, 5, true], [185, 5, true]]);
    expect(sets(parseCell(185, { prescribed: rx }))).toEqual([[185, 5, true], [185, 5, true], [185, 5, true]]);
  });
  it("one bare number with no prescription is one set, reps unknown", () => {
    expect(sets(parseCell("185"))).toEqual([[185, null, true]]);
    expect(sets(parseCell("185", { prescribed: { sets: 1, reps: 5 } }))).toEqual([[185, 5, true]]);
    expect(sets(parseCell("185x5", { prescribed: rx }))).toEqual([[185, 5, false]]);
  });
  it("decimals use a point", () => {
    expect(sets(parseCell("132.5 135", { prescribed: rx }))).toEqual([[132.5, 5, true], [135, 5, true]]);
    expect(sets(parseCell("2.5x10"))).toEqual([[2.5, 10, false]]);
  });
  it("a spreadsheet number cell works", () => {
    expect(sets(parseCell(225.5, { prescribed: { sets: 1, reps: 3 } }))).toEqual([[225.5, 3, true]]);
  });
  it("as many sets as were written, even when they differ from the sheet", () => {
    expect(sets(parseCell("225 235", { prescribed: rx }))).toEqual([[225, 5, true], [235, 5, true]]);
    expect(sets(parseCell("225 235 245 255", { prescribed: rx }))).toHaveLength(4);
  });
});

describe("team sheet cell reader: body weight", () => {
  it("BW alone is the prescribed sets and reps", () => {
    expect(sets(parseCell("BW", { prescribed: { sets: 3, reps: 10 } }))).toEqual([[null, 10, true], [null, 10, true], [null, 10, true]]);
    // no reps written and none prescribed would save nothing: the reader says it is not sure
    expect(parseCell("bw").kind).toBe("unsure");
    expect(sets(parseCell("Bodyweight", { prescribed: { sets: 2, reps: 8 } }))).toEqual([[null, 8, true], [null, 8, true]]);
  });
  it("BW followed by numbers is the reps of each set", () => {
    expect(sets(parseCell("BW 10 10 8"))).toEqual([[null, 10, false], [null, 10, false], [null, 8, false]]);
    expect(sets(parseCell("bw 12, 10, 8"))).toEqual([[null, 12, false], [null, 10, false], [null, 8, false]]);
  });
  it("BW with something that is not reps is unsure", () => {
    expect(parseCell("BW heavy").kind).toBe("unsure");
    expect(parseCell("BW 10.5").kind).toBe("unsure");
    expect(parseCell("BW 0").kind).toBe("unsure");
  });
});

describe("team sheet cell reader: units", () => {
  it("the sheet's own unit after a number is dropped", () => {
    expect(sets(parseCell("225 lb", { prescribed: { sets: 1, reps: 5 } }))).toEqual([[225, 5, true]]);
    expect(sets(parseCell("225lbs 235lbs"))).toEqual([[225, null, true], [235, null, true]]);
    expect(sets(parseCell("100kg", { unit: "kg", prescribed: { sets: 1, reps: 5 } }))).toEqual([[100, 5, true]]);
  });
  it("the other unit makes the cell unsure; nothing is converted behind anyone's back", () => {
    expect(parseCell("100kg").kind).toBe("unsure");
    expect(parseCell("100 kg 110 kg").kind).toBe("unsure");
    expect(parseCell("225 lb", { unit: "kg" }).kind).toBe("unsure");
  });
});

describe("team sheet cell reader: what it will not guess", () => {
  it("a smudge, a word or a stray mark leaves the whole cell unsure, with the text kept", () => {
    for (const v of ["2?5", "abc", "225 felt heavy", "225 2?5 245", "2 2 5 x", "225x", "x5", "225xx5", "225x5x", "~225", "225#", "?"]) {
      const c = parseCell(v, { prescribed: rx });
      expect(c.kind, v).toBe("unsure");
      if (c.kind === "unsure") expect(c.raw).toBe(v.trim());
    }
  });
  it("numbers that are not believable are unsure", () => {
    for (const v of ["0", "0 225", "225x0", "225x101", "225x5x0", "225x5x21", "2001", "-5", "225x5.5"]) expect(parseCell(v, { prescribed: rx }).kind, v).toBe("unsure");
  });
  it("more than the largest believable number of sets is unsure", () => {
    expect(parseCell(Array.from({ length: MAX_SETS + 1 }, () => "100").join(" ")).kind).toBe("unsure");
    expect(parseCell(Array.from({ length: MAX_SETS }, () => "100").join(" ")).kind).toBe("sets");
  });
  it("a bare unit and nothing else is unsure, not empty", () => {
    expect(parseCell("lb").kind).toBe("unsure");
  });
  it("never throws, whatever it is given", () => {
    for (const v of [NaN, Infinity, {}, [], true, "\u0000", "9".repeat(5000), "x".repeat(300), "💪", 12345678901234567890]) expect(() => parseCell(v as any)).not.toThrow();
  });
});

describe("team sheet cell reader: describing what was read", () => {
  it("says it in plain words for the review screen", () => {
    expect(describeCell(parseCell("225x5 235x3"))).toBe("225 lb x 5, 235 lb x 3");
    expect(describeCell(parseCell("225 235", { prescribed: rx }))).toBe("225 lb x 5, 235 lb x 5 (reps from the sheet)");
    expect(describeCell(parseCell("BW 10 8"))).toBe("BW x 10, BW x 8");
    expect(describeCell(parseCell("100", { unit: "kg", prescribed: { sets: 1, reps: 3 } }), "kg")).toBe("100 kg x 3 (reps from the sheet)");
    expect(describeCell(parseCell(""))).toBe("");
    expect(describeCell(parseCell("-"))).toBe("skipped");
    expect(describeCell(parseCell("2?5"))).toBe("not sure: 2?5");
  });
});
