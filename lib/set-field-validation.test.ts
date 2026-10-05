import { describe, it, expect } from "vitest";
import { validateSetFieldInput } from "./set-field-validation";

describe("validateSetFieldInput", () => {
  it("treats an empty cell as cleared", () => {
    expect(validateSetFieldInput("rpe", "  ")).toEqual({ ok: true, value: null });
  });
  it("accepts RPE from 1 to 10 including halves", () => {
    expect(validateSetFieldInput("rpe", "8.5")).toEqual({ ok: true, value: 8.5 });
    expect(validateSetFieldInput("rpe", "10")).toEqual({ ok: true, value: 10 });
    expect(validateSetFieldInput("rpe", "1")).toEqual({ ok: true, value: 1 });
  });
  it("rejects RPE outside 1-10", () => {
    expect(validateSetFieldInput("rpe", "89").ok).toBe(false);
    expect(validateSetFieldInput("rpe", "0").ok).toBe(false);
  });
  it("allows RIR 0 but not above 10", () => {
    expect(validateSetFieldInput("rir", "0")).toEqual({ ok: true, value: 0 });
    expect(validateSetFieldInput("rir", "11").ok).toBe(false);
  });
  it("rejects decimal reps and says why", () => {
    const r = validateSetFieldInput("reps", "5.5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/whole number/);
  });
  it("rejects non-numeric reps instead of saving NaN", () => {
    expect(validateSetFieldInput("reps", "5-8").ok).toBe(false);
    expect(validateSetFieldInput("weight", "abc").ok).toBe(false);
  });
  it("rejects negative weight", () => {
    expect(validateSetFieldInput("weight", "-5").ok).toBe(false);
  });
  it("passes text fields through trimmed", () => {
    expect(validateSetFieldInput("tempo", " 3-1-1 ")).toEqual({ ok: true, value: "3-1-1" });
  });
});
