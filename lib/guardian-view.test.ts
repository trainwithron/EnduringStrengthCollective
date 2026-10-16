import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { underThirteenOn } from "@/lib/guardian-view";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("underThirteenOn: the under-13 line, on the coach's calendar day", () => {
  it("is under 13 until the 13th birthday, and not on it", () => {
    expect(underThirteenOn("2013-10-12", "2026-10-11")).toBe(true);
    expect(underThirteenOn("2013-10-12", "2026-10-12")).toBe(false);
    expect(underThirteenOn("2010-01-01", "2026-10-12")).toBe(false);
    expect(underThirteenOn("2020-06-30", "2026-10-12")).toBe(true);
  });
  it("handles a leap day", () => {
    expect(underThirteenOn("2015-03-01", "2028-02-29")).toBe(true);
    expect(underThirteenOn("2015-02-28", "2028-02-29")).toBe(false);
  });
});

describe("the public parent page re-checks everything on every visit", () => {
  const lib = read("lib/guardian-view.ts");
  it("refuses a revoked, expired or never-dated link", () => {
    expect(lib).toContain("if (!link || link.revoked_at) return null;");
    expect(lib).toContain("if (!link.expires_at || new Date(link.expires_at).getTime() <= Date.now()) return null;");
  });
  it("needs the child still a client of the group, the coach who made it still its coach, and the child still under 13", () => {
    expect(lib).toContain('athleteMember?.role !== "athlete" || coachMember?.role !== "coach"');
    expect(lib).toContain("underThirteenOn(intake.date_of_birth, todayKey)");
  });
  it("uses the coach's business-zone day, not the UTC date", () => {
    expect(lib).toContain("dateKeyInZone(zone)");
    expect(lib).not.toContain("new Date().toISOString().slice(0, 10)");
  });
  it("is not listed by search engines", () => {
    expect(read("app/guardian/[token]/page.tsx")).toContain("robots");
  });
});

describe("the migration scopes who can make a link", () => {
  const sql = read("supabase/migrations/0338_guardian_links_scoped.sql");
  it("checks the group, the membership, the age and the expiry on insert, and lets a coach change only revoked_at", () => {
    expect(sql).toContain("public.guardian_link_allowed(athlete_id, group_id)");
    expect(sql).toContain("gm.role = 'athlete'");
    expect(sql).toContain("interval '13 years'");
    expect(sql).toContain("expires_at <= now() + interval '91 days'");
    expect(sql).toContain("grant update (revoked_at) on public.guardian_links to authenticated;");
  });
  it("closes the three internal training-partner functions to the browser and keeps the combined one", () => {
    for (const fn of ["training_partner_is_minor", "training_partner_intake_incomplete", "training_partner_org_restricted"]) {
      expect(sql).toContain(`revoke execute on function public.${fn}(uuid) from public, anon, authenticated;`);
    }
    expect(sql).not.toContain("revoke execute on function public.training_partner_is_restricted");
  });
});

import { guardianMealsFrom } from "@/lib/guardian-view";

describe("the parent view reads a real stored meal plan (an object keyed by day type, not a list)", () => {
  const entry = (mealId: string, title: string, proteinTarget: number) => ({ mealId, title, proteinTarget, carbsTarget: 40, fatTarget: 10, recipes: [] });
  it("a daily plan gives its meals and the plan's own protein for the day", () => {
    const r = guardianMealsFrom({ daily: [entry("1", "Breakfast", 30), entry("2", "Lunch", 40)] }, { daily: { calories: 2000, protein: 150 } });
    expect(r.meals).toEqual([{ id: "1", title: "Breakfast" }, { id: "2", title: "Lunch" }]);
    expect(r.prescribedProtein).toBe(150);
  });
  it("without plan macros the protein is what the meals add up to; a train/rest plan uses the first filled day type", () => {
    const r = guardianMealsFrom({ train: [entry("1", "Pre", 25), entry("2", "Post", 35)], rest: [] }, null);
    expect(r.meals.map((m) => m.title)).toEqual(["Pre", "Post"]);
    expect(r.prescribedProtein).toBe(60);
  });
  it("anything else (null, a list, an empty plan) is an empty plan and never throws", () => {
    for (const bad of [null, undefined, [], "x", 5, {}, { daily: [] }, { daily: "no" }]) {
      expect(guardianMealsFrom(bad, null)).toEqual({ meals: [], prescribedProtein: 0 });
    }
  });
  it("the page only reads this group's plan and food log", () => {
    const src = readFileSync(join(__dirname, "guardian-view.ts"), "utf8");
    expect(src.match(/\.eq\("group_id", link\.group_id\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
