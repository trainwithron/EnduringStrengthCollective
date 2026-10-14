import { describe, it, expect } from "vitest";
import { EMPTY_SCAN, FIELD_LABELS, INBODY_SYSTEM_PROMPT, KG_TO_LB, normalizeScan, numberFromField, parsePrintedDate, sanityChecks, toPounds, type ScanValues } from "@/lib/inbody-scan";

// What a model might return for a sheet printed in kilograms (an InBody 570 style result).
const KG_SHEET = {
  scanDateText: "2026.08.12 07:41",
  weight: { value: 82.7, unit: "kg" },
  skeletalMuscleMass: { value: 37.2, unit: "kg" },
  bodyFatMass: { value: 14.4, unit: "kg" },
  percentBodyFat: 17.4,
  leanBodyMass: { value: 68.3, unit: "kg" },
  bmi: 24.9,
  totalBodyWater: { value: 50.0, unit: "L" },
  ecwRatio: 0.38,
  visceralFatLevel: 7,
  bmr: 1790,
  inbodyScore: 78,
  segmental: {
    rightArm: { lean: { value: 3.8, unit: "kg" }, fat: { value: 0.7, unit: "kg" } },
    trunk: { lean: { value: 29.9, unit: "kg" }, fat: { value: 7.2, unit: "kg" } },
    leftLeg: null,
  },
};

describe("units", () => {
  it("kilograms become pounds, pounds stay, an unknown or missing unit is never guessed", () => {
    expect(toPounds({ value: 100, unit: "kg" })).toBe(220.5);
    expect(toPounds({ value: 180, unit: "lb" })).toBe(180);
    expect(toPounds({ value: 180, unit: "LBS" })).toBe(180);
    expect(toPounds({ value: 180, unit: "stone" })).toBeNull();
    expect(toPounds({ value: 180 })).toBeNull();
    expect(toPounds({ value: "abc", unit: "kg" })).toBeNull();
    expect(toPounds(null)).toBeNull();
    expect(KG_TO_LB).toBeCloseTo(2.2046, 4);
  });
});

describe("the printed date", () => {
  it("year first is unambiguous, in any of the usual separators", () => {
    expect(parsePrintedDate("2026.08.12 07:41")).toBe("2026-08-12");
    expect(parsePrintedDate("2026-8-2")).toBe("2026-08-02");
    expect(parsePrintedDate("Date 2026/08/12")).toBe("2026-08-12");
  });
  it("month and day first only when one of them cannot be a month", () => {
    expect(parsePrintedDate("08/12/2026")).toBeNull(); // 8 December or 12 August: the person chooses
    expect(parsePrintedDate("25/12/2026")).toBe("2026-12-25");
    expect(parsePrintedDate("12/25/2026")).toBe("2026-12-25");
  });
  it("nothing readable, or an impossible date, is blank", () => {
    expect(parsePrintedDate(null)).toBeNull();
    expect(parsePrintedDate("")).toBeNull();
    expect(parsePrintedDate("yesterday")).toBeNull();
    expect(parsePrintedDate("2026.02.31")).toBeNull();
    expect(parsePrintedDate("1999.01.01")).toBeNull();
  });
});

describe("turning a sheet into numbers", () => {
  const v = normalizeScan(KG_SHEET);
  it("every number comes out in pounds and litres with the date", () => {
    expect(v.scanDate).toBe("2026-08-12");
    expect(v.weightLb).toBe(182.3);
    expect(v.skeletalMuscleLb).toBe(82);
    expect(v.bodyFatMassLb).toBe(31.7);
    expect(v.leanMassLb).toBe(150.6);
    expect(v.percentBodyFat).toBe(17.4);
    expect(v.bmi).toBe(24.9);
    expect(v.totalBodyWaterL).toBe(50);
    expect(v.ecwRatio).toBe(0.38);
    expect(v.visceralLevel).toBe(7);
    expect(v.bmrKcal).toBe(1790);
    expect(v.inbodyScore).toBe(78);
  });
  it("the limb numbers are kept for the limbs the sheet has, in pounds", () => {
    expect(v.segments?.rightArm).toEqual({ leanLb: 8.4, fatLb: 1.5 });
    expect(v.segments?.trunk).toEqual({ leanLb: 65.9, fatLb: 15.9 });
    expect(v.segments?.leftLeg).toBeUndefined();
  });
  it("a sheet with nothing readable gives blanks, never invented numbers", () => {
    expect(normalizeScan({})).toEqual(EMPTY_SCAN);
    expect(normalizeScan(null)).toEqual(EMPTY_SCAN);
    expect(normalizeScan({ error: "That doesn't look like a readable InBody sheet." })).toEqual(EMPTY_SCAN);
  });
  it("an impossible number is dropped to blank, the rest stay", () => {
    const bad = normalizeScan({ ...KG_SHEET, percentBodyFat: 174, weight: { value: 9999, unit: "kg" }, bmi: 0.2, bmr: 17 });
    expect(bad.percentBodyFat).toBeNull();
    expect(bad.weightLb).toBeNull();
    expect(bad.bmi).toBeNull();
    expect(bad.bmrKcal).toBeNull();
    expect(bad.skeletalMuscleLb).toBe(82);
  });
  it("a sheet printed in pounds is read as pounds, and numbers sent as text still count", () => {
    const lb = normalizeScan({ weight: { value: "182.4", unit: "lb" }, percentBodyFat: "17.4", totalBodyWater: { value: 112, unit: "lb" } });
    expect(lb.weightLb).toBe(182.4);
    expect(lb.percentBodyFat).toBe(17.4);
    expect(lb.totalBodyWaterL).toBe(50.8);
  });
});

describe("the checks on the review screen", () => {
  const v = normalizeScan(KG_SHEET);
  it("numbers that agree with each other pass", () => {
    const checks = sanityChecks(v);
    expect(checks.map((c) => c.key)).toEqual(["mass", "percent", "muscle", "bmi"]);
    expect(checks.every((c) => c.ok)).toBe(true);
  });
  it("a misread digit shows up: lean plus fat no longer adds to the weight", () => {
    const misread: ScanValues = { ...v, leanMassLb: 105.6 };
    const mass = sanityChecks(misread).find((c) => c.key === "mass")!;
    expect(mass.ok).toBe(false);
    expect(mass.detail).toContain("105.6");
  });
  it("percent body fat that does not match fat over weight is flagged; muscle above lean mass is flagged", () => {
    expect(sanityChecks({ ...v, percentBodyFat: 31.4 }).find((c) => c.key === "percent")!.ok).toBe(false);
    expect(sanityChecks({ ...v, skeletalMuscleLb: 160 }).find((c) => c.key === "muscle")!.ok).toBe(false);
  });
  it("a BMI that cannot fit any real height is flagged", () => {
    expect(sanityChecks({ ...v, bmi: 90 }).find((c) => c.key === "bmi")!.ok).toBe(false);
  });
  it("only the checks whose numbers are all there are made; a blank sheet makes none", () => {
    expect(sanityChecks({ ...EMPTY_SCAN, weightLb: 180 })).toEqual([]);
    expect(sanityChecks({ ...EMPTY_SCAN, weightLb: 180, bodyFatMassLb: 30, percentBodyFat: 16.7 }).map((c) => c.key)).toEqual(["percent"]);
  });
});

describe("the form", () => {
  it("text typed by a person is read back as a number, blank stays blank, nonsense is blank", () => {
    expect(numberFromField(" 182.4 ")).toBe(182.4);
    expect(numberFromField("1,790")).toBe(1790);
    expect(numberFromField("")).toBeNull();
    expect(numberFromField("abc")).toBeNull();
  });
  it("every number the app stores has a labelled field", () => {
    expect(FIELD_LABELS.map((f) => f.key)).toEqual(["weightLb", "skeletalMuscleLb", "bodyFatMassLb", "percentBodyFat", "leanMassLb", "bmi", "totalBodyWaterL", "ecwRatio", "visceralLevel", "bmrKcal", "inbodyScore"]);
  });
});

describe("what the AI is told", () => {
  it("to copy, never compute; to give the printed unit; to say null when unsure; and what to say about a sheet it cannot read", () => {
    expect(INBODY_SYSTEM_PROMPT).toContain("You COPY numbers exactly as printed");
    expect(INBODY_SYSTEM_PROMPT).toContain("never calculate");
    expect(INBODY_SYSTEM_PROMPT).toContain("unit that is PRINTED");
    expect(INBODY_SYSTEM_PROMPT).toContain("Use null for anything you cannot read");
    expect(INBODY_SYSTEM_PROMPT).toContain("That doesn't look like a readable InBody sheet");
  });
});
