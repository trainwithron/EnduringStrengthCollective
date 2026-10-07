import { describe, expect, it } from "vitest";
import { formatRest, MAX_REST_SECONDS, parseRestInput, restForSet } from "@/lib/rest-time";

describe("the coach's rest field accepts a clear format and shows m:ss", () => {
  it("reads 5:00, 300, 90s, 2m and 2m30", () => {
    const seconds = (t: string) => {
      const r = parseRestInput(t);
      return r.ok ? r.seconds : "bad";
    };
    expect(seconds("5:00")).toBe(300);
    expect(seconds("300")).toBe(300);
    expect(seconds("3:30")).toBe(210);
    expect(seconds("90s")).toBe(90);
    expect(seconds("90 sec")).toBe(90);
    expect(seconds("2m")).toBe(120);
    expect(seconds("2 min")).toBe(120);
    expect(seconds("2m30")).toBe(150);
    expect(seconds("2m 30s")).toBe(150);
    expect(seconds("0:45")).toBe(45);
    expect(seconds("  5:00 ")).toBe(300);
  });
  it("empty means no rest (null), and nonsense is refused", () => {
    expect(parseRestInput("")).toEqual({ ok: true, seconds: null });
    expect(parseRestInput("   ")).toEqual({ ok: true, seconds: null });
    for (const bad of ["abc", "5:75", "-30", "5:", ":30", "1.5", "5 minutes ago", "99999999", "2m75", "1:30:00", "3000", "31:00"]) expect(parseRestInput(bad).ok).toBe(false);
  });
  it("refuses more than 30 minutes (3000 for 300 is a slip) and accepts the limit itself", () => {
    expect(parseRestInput(String(MAX_REST_SECONDS))).toEqual({ ok: true, seconds: MAX_REST_SECONDS });
    expect(parseRestInput(String(MAX_REST_SECONDS + 1)).ok).toBe(false);
    expect(parseRestInput("30:00")).toEqual({ ok: true, seconds: 1800 });
  });
  it("0 means no rest (null), the same as empty", () => {
    expect(parseRestInput("0")).toEqual({ ok: true, seconds: null });
    expect(parseRestInput("0:00")).toEqual({ ok: true, seconds: null });
    expect(parseRestInput("0s")).toEqual({ ok: true, seconds: null });
  });
  it("a bare small number is flagged (probably minutes), a unit or colon or a larger number is not", () => {
    expect(parseRestInput("3")).toEqual({ ok: true, seconds: 3, bare: true });
    expect(parseRestInput("19")).toEqual({ ok: true, seconds: 19, bare: true });
    expect(parseRestInput("20")).toEqual({ ok: true, seconds: 20 });
    expect(parseRestInput("90")).toEqual({ ok: true, seconds: 90 });
    expect(parseRestInput("3s")).toEqual({ ok: true, seconds: 3 });
    expect(parseRestInput("3:00")).toEqual({ ok: true, seconds: 180 });
    expect(parseRestInput("3m")).toEqual({ ok: true, seconds: 180 });
  });
  it("shows seconds as m:ss", () => {
    expect(formatRest(300)).toBe("5:00");
    expect(formatRest(90)).toBe("1:30");
    expect(formatRest(45)).toBe("0:45");
    expect(formatRest(0)).toBe("0:00");
    expect(formatRest(5400)).toBe("1:30:00");
    expect(formatRest(61)).toBe("1:01");
  });
  it("what the coach types round-trips: 5:00 -> 300 -> 5:00", () => {
    const r = parseRestInput("5:00");
    expect(r.ok && formatRest(r.seconds as number)).toBe("5:00");
  });
});

const set = (id: string, setOrder: number, target: number | null, typed: number | null = null) => ({ id, setOrder, targetRestSeconds: target, restSeconds: typed });

describe("the rest that applies after a set", () => {
  it("is the coach's rest for THAT set, and can differ by set", () => {
    const sets = [set("a", 0, 120), set("b", 1, 180), set("c", 2, 300)];
    expect(restForSet(sets, "a")).toEqual({ seconds: 120, source: "coach" });
    expect(restForSet(sets, "b")).toEqual({ seconds: 180, source: "coach" });
    expect(restForSet(sets, "c")).toEqual({ seconds: 300, source: "coach" });
  });
  it("beats a number the client typed for that set (the coach's rest is the only option)", () => {
    expect(restForSet([set("a", 0, 180, 60)], "a")).toEqual({ seconds: 180, source: "coach" });
  });
  it("a set the client ADDED inherits the rest of the last prescribed set, so it never falls back to the picker", () => {
    const sets = [set("a", 0, 120), set("b", 1, 180), set("added", 2, null)];
    expect(restForSet(sets, "added")).toEqual({ seconds: 180, source: "coach" });
    const two = [set("a", 0, 120), set("b", 1, 180), set("x", 2, null), set("y", 3, null)];
    expect(restForSet(two, "y")).toEqual({ seconds: 180, source: "coach" });
  });
  it("only looks BEFORE the set: an unprescribed first set does not borrow from a later one", () => {
    expect(restForSet([set("a", 0, null), set("b", 1, 120)], "a")).toBeNull();
  });
  it("with no coach rest at all a rest the client typed is used, as before; with nothing, null (the usual picker)", () => {
    expect(restForSet([set("a", 0, null, 75)], "a")).toEqual({ seconds: 75, source: "typed" });
    expect(restForSet([set("a", 0, null, null)], "a")).toBeNull();
  });
  it("treats a zero or missing target as no coach rest, and an unknown set as nothing", () => {
    expect(restForSet([set("a", 0, 0)], "a")).toBeNull();
    expect(restForSet([set("a", 0, 120)], "missing")).toBeNull();
  });
  it("a typed 0 or a stored 0 counts as no rest: the set uses the nearest earlier rest, or the picker", () => {
    expect(restForSet([set("a", 0, 120), set("b", 1, 0)], "b")).toEqual({ seconds: 120, source: "coach" });
    expect(restForSet([set("a", 0, 0)], "a")).toBeNull();
  });
});
