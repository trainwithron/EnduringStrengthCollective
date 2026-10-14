import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { searchExercises } from "@/lib/exercise-search";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the client's Home shop heading is the coach's Pro Shop", () => {
  it("'[First name]'s Pro Shop', plain 'Pro Shop' with no name, and no more 'From your coach' over the cards", () => {
    const list = read("components/athlete/pro-shop-list.tsx");
    expect(list).toContain("`${first}'s Pro Shop`");
    expect(list).toContain(': "Pro Shop"');
    expect(list).not.toContain('<h2 className="font-body text-xs uppercase tracking-wide text-steel mb-2">From your coach</h2>');
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain('coachName={roster.find((m) => m.role === "coach")?.fullName ?? null}');
  });
});

describe("typing 'bench press' lists the exact exercise first, then the coach's most-used", () => {
  it("an exact 'Bench Press' leads; among longer names the library order (most-used first) decides", () => {
    const library = ["Dumbbell Bench Press", "Barbell Bench Press", "Bench Press", "Incline Bench Press"];
    expect(searchExercises("bench press", library, []).map((r) => r.name)).toEqual(["Bench Press", "Dumbbell Bench Press", "Barbell Bench Press", "Incline Bench Press"]);
  });
});
