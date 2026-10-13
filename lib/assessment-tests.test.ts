import { describe, it, expect } from "vitest";
import { ASSESSMENT_TESTS, cleanValue, formatMeasurements, MAX_MEASUREMENTS_CHARS } from "@/lib/assessment-tests";

describe("in-person assessment logger", () => {
  it("has the approved fixed list", () => {
    expect(ASSESSMENT_TESTS.map((t) => `${t.name} (${t.unit})`)).toEqual([
      "Grip strength (kg)",
      "Vertical jump (in)",
      "40-yard dash (sec)",
      "Sit and reach (in)",
      "Resting heart rate (bpm)",
      "Body weight (lb)",
      "Waist (in)",
    ]);
  });
  it("writes one line per filled row and skips blank or non-number rows", () => {
    const out = formatMeasurements([
      { name: "Grip strength", unit: "kg", value: "42" },
      { name: "Vertical jump", unit: "in", value: "" },
      { name: "40-yard dash", unit: "sec", value: "5,2" },
      { name: "Waist", unit: "in", value: "abc" },
      { name: "Box jump: max", unit: "in", value: "30.5" },
    ]);
    expect(out.text).toBe("Grip strength: 42 kg\n40-yard dash: 5.2 sec\nBox jump max: 30.5 in");
    expect(out.count).toBe(3);
  });
  it("accepts only plain numbers", () => {
    expect(cleanValue(" 12 ")).toBe("12");
    expect(cleanValue("12.5")).toBe("12.5");
    expect(cleanValue("-3")).toBeNull();
    expect(cleanValue("1e5")).toBeNull();
    expect(cleanValue("")).toBeNull();
  });
  it("never exceeds the stored limit and never cuts a line", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ name: `Custom test number ${i}`, unit: "kg", value: "100" }));
    const out = formatMeasurements(many);
    expect(out.text.length).toBeLessThanOrEqual(MAX_MEASUREMENTS_CHARS);
    expect(out.text.split("\n").every((l) => /: 100 kg$/.test(l))).toBe(true);
  });
});
