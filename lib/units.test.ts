import { describe, expect, it } from "vitest";
import { cmToFtIn, displayWeightValue, formatHeight, formatWeight, ftInToCm, kgToLb, lbToKg, parseHeightInput, parseWeightInput } from "@/lib/units";

describe("weight conversion", () => {
  it("converts both ways", () => {
    expect(lbToKg(220)).toBeCloseTo(99.79, 2);
    expect(kgToLb(100)).toBeCloseTo(220.46, 2);
    expect(kgToLb(lbToKg(187.4))).toBeCloseTo(187.4, 9);
  });
  it("shows one decimal and drops a trailing .0", () => {
    expect(formatWeight(180, "lb")).toBe("180 lb");
    expect(formatWeight(180.54, "lb")).toBe("180.5 lb");
    expect(formatWeight(180, "kg")).toBe("81.6 kg");
    expect(formatWeight(220.46, "kg")).toBe("100 kg");
    expect(formatWeight(null, "lb")).toBe("");
    expect(displayWeightValue(150, "kg")).toBe(68);
  });
});

describe("typed weights are stored once as pounds", () => {
  it("reads kilograms and pounds, with a comma decimal and a unit suffix", () => {
    expect(parseWeightInput("80", "kg")).toBe(176.37);
    expect(parseWeightInput("80,5", "kg")).toBe(177.47);
    expect(parseWeightInput("180 lb", "lb")).toBe(180);
    expect(parseWeightInput("81.9kg", "kg")).toBe(180.56);
  });
  it("80.0 kg does not drift after a round trip: the stored pounds show 80 again", () => {
    const stored = parseWeightInput("80", "kg") as number;
    expect(displayWeightValue(stored, "kg")).toBe(80);
  });
  it("refuses what is not a believable body weight", () => {
    for (const bad of ["", "abc", "0", "-5", "5", "1500", "12.3.4", "kg"]) expect(parseWeightInput(bad, "lb")).toBeNull();
    expect(parseWeightInput("9", "kg")).toBeNull();
    expect(parseWeightInput("20", "lb")).toBe(20);
    expect(parseWeightInput("1000", "lb")).toBe(1000);
    expect(parseWeightInput("1000.5", "lb")).toBeNull();
  });
});

describe("height", () => {
  it("feet and inches carry correctly", () => {
    expect(cmToFtIn(178)).toEqual({ ft: 5, inches: 10 });
    expect(cmToFtIn(182.8)).toEqual({ ft: 6, inches: 0 });
    expect(ftInToCm(5, 10)).toBe(177.8);
    expect(ftInToCm(6, 0)).toBe(182.9);
  });
  it("follows the weight setting", () => {
    expect(formatHeight(178, "lb")).toBe("5'10\"");
    expect(formatHeight(178, "kg")).toBe("178 cm");
    expect(formatHeight(null, "lb")).toBe("");
  });
  it("reads centimetres and feet and inches", () => {
    expect(parseHeightInput("178", "kg")).toBe(178);
    expect(parseHeightInput("178 cm", "lb")).toBe(178);
    expect(parseHeightInput("5'10", "lb")).toBe(177.8);
    expect(parseHeightInput("5 10", "lb")).toBe(177.8);
    expect(parseHeightInput("6", "lb")).toBeNull();
    expect(parseHeightInput("50", "kg")).toBeNull();
    expect(parseHeightInput("300", "kg")).toBeNull();
    expect(parseHeightInput("tall", "lb")).toBeNull();
  });
});
