import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const cron = src("../../../app/api/cron/nutrition-checkin-suggestions/route.ts");
const clientNutrition = src("./client-nutrition.tsx");
const card = src("../desktop/nutrition-checkin-suggestion-card.tsx");
const list = src("../desktop/nutrition-checkin-suggestions-list.tsx");
const migration = src("../../../supabase/migrations/0295_about_you_baseline_phase_of_record.sql");

// Assistant's review of Phase 2.
describe("the weekly job reads whole lists (the database returns at most 1,000 rows a call)", () => {
  it("pages the check-ins, the phase plans and every list that decides who already has a target", () => {
    expect(cron).toContain('from("nutrition_checkins")');
    expect(cron).toMatch(/pageAll\(\(from, to\) =>\s+supabase\s+\.from\("nutrition_checkins"\)/);
    expect(cron).toMatch(/pageAll\(\(from, to\) =>\s+supabase\s+\.from\("client_phase_plans"\)/);
    expect(cron).toContain('supabase.from("group_memberships").select("profile_id, group_id, client_tier")');
    expect(cron).toContain('supabase.from("client_macro_target_history").select("athlete_id, group_id")');
    expect(cron).toContain('.eq("kind", "baseline")');
    expect((cron.match(/pageAll\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it("a list that could not be read in full stops the run or the seeding rather than acting on part of it", () => {
    expect(cron).toContain("if (checkinPage.failed)");
    expect(cron).toContain("if (planPage.failed)");
    expect(cron).toContain("members.truncated || standing.truncated || baselines.truncated");
    expect(cron).toContain('skipped: "a list could not be read in full"');
  });
  it("seeds in parallel batches", () => {
    expect(cron).toContain("Promise.all(candidates.slice(i, i + BATCH).map(seedOne))");
  });
});

describe("a team coach is not sent one notice per athlete", () => {
  it("the trigger folds a later starting target into the unread notice", () => {
    expect(migration).toContain("n.read_at is null and n.created_at > now() - interval '1 day'");
    expect(migration).toContain("Starting targets are ready for several clients");
  });
});

describe("age unknown and a minor's held cut are said out loud", () => {
  it("the weekly job's suggestion text says age is unknown when there is no date of birth", () => {
    expect(cron).toContain("AGE_UNKNOWN_NOTE");
    expect(cron).toContain("dob ? engineResult.rationale");
  });
  it("the card and the Targets header say it, and a held cut is recorded in the run's result", () => {
    expect(card).toContain("{!ageKnown && !isBaseline");
    expect(list).toContain("ageKnown={ageKnown}");
    expect(clientNutrition).toContain("ageKnown={ageYears != null}");
    expect(clientNutrition).toContain("minorSafetyLine(");
    expect(cron).toContain("heldForAge");
  });
});
