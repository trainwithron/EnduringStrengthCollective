import { describe, it, expect } from "vitest";
import { cleanDateWord, isSearching, matchesLoggedSearch, namesBySessionFrom, readSearchWords } from "@/lib/logged-search";

const names = namesBySessionFrom([
  { sessionId: "a", exerciseName: "Back Squat" },
  { sessionId: "a", exerciseName: "Seated Row" },
  { sessionId: "b", exerciseName: "Bench Press" },
]);
const a = { sessionId: "a", dateKey: "2026-08-12" };
const b = { sessionId: "b", dateKey: "2026-09-03" };
const none = { sessionId: null, dateKey: "2026-09-03" };

describe("searching logged workouts", () => {
  it("by exercise name, ignoring case and part words, finding a workout by any exercise in it", () => {
    const words = readSearchWords({ q: "SQUAT" });
    expect(matchesLoggedSearch(a, names, words)).toBe(true);
    expect(matchesLoggedSearch(b, names, words)).toBe(false);
    expect(matchesLoggedSearch(a, names, readSearchWords({ q: "row" }))).toBe(true);
  });
  it("by part of a date", () => {
    expect(matchesLoggedSearch(a, names, readSearchWords({ q: "2026-08" }))).toBe(true);
    expect(matchesLoggedSearch(b, names, readSearchWords({ q: "2026-08" }))).toBe(false);
  });
  it("between two dates, both ends included, either end optional", () => {
    expect(matchesLoggedSearch(a, names, readSearchWords({ from: "2026-08-12", to: "2026-08-12" }))).toBe(true);
    expect(matchesLoggedSearch(a, names, readSearchWords({ from: "2026-08-13" }))).toBe(false);
    expect(matchesLoggedSearch(b, names, readSearchWords({ to: "2026-09-02" }))).toBe(false);
    expect(matchesLoggedSearch(b, names, readSearchWords({ from: "2026-09-01", to: "2026-09-30", q: "bench" }))).toBe(true);
  });
  it("a workout with no recorded exercises is found by date but not by exercise", () => {
    expect(matchesLoggedSearch(none, names, readSearchWords({ q: "squat" }))).toBe(false);
    expect(matchesLoggedSearch(none, names, readSearchWords({ q: "2026-09" }))).toBe(true);
  });
  it("no search words match everything and say they are not searching", () => {
    const words = readSearchWords({});
    expect(isSearching(words)).toBe(false);
    expect(matchesLoggedSearch(a, names, words)).toBe(true);
    expect(isSearching(readSearchWords({ q: "x" }))).toBe(true);
  });
  it("only real dates are used; anything else is ignored; long text is cut", () => {
    expect(cleanDateWord("2026-08-12")).toBe("2026-08-12");
    expect(cleanDateWord("08/12/2026")).toBe("");
    expect(cleanDateWord("2026-13-45")).toBe("");
    expect(cleanDateWord(undefined)).toBe("");
    expect(readSearchWords({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(readSearchWords({ from: "nope", to: "2026-08-12" })).toEqual({ q: "", from: "", to: "2026-08-12" });
  });
});
