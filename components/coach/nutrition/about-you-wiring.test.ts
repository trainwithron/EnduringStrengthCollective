import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const aboutYouPage = src("../../../app/(coach)/groups/[groupId]/about-you/page.tsx");
const aboutYouForm = src("../../athlete/about-you-form.tsx");
const aboutYouCard = src("../../athlete/about-you-card.tsx");
const home = src("../../../app/(coach)/groups/[groupId]/page.tsx");
const settings = src("../../../app/(coach)/groups/[groupId]/settings/page.tsx");
const clientNutrition = src("./client-nutrition.tsx");
const bodyEditor = src("./body-profile-editor.tsx");
const baselinePrompt = src("./baseline-prompt.tsx");
const phaseCard = src("./phase-of-record-card.tsx");
const suggestionCard = src("../desktop/nutrition-checkin-suggestion-card.tsx");
const panel = src("../desktop/weekly-checkin-panel.tsx");
const cron = src("../../../app/api/cron/nutrition-checkin-suggestions/route.ts");
const weightWidget = src("../../athlete/weight-log-widget.tsx");
const phaseWrite = src("../../../lib/phase-plan-write.ts");

// Phase 2: About you, the starting target, the phase of record, real adherence, units.
describe("About you (the client's side)", () => {
  it("is a client-only page that reads the one date-of-birth reader and asks the date only when none is on file", () => {
    expect(aboutYouPage).toContain('membership?.role !== "athlete"');
    expect(aboutYouPage).toContain("readDateOfBirth(profile)");
    expect(aboutYouForm).toContain("!initial.dateOfBirthKnown");
    expect(aboutYouForm).toContain("profileRow.birthday = dob");
  });
  it("writes the client's own profile row, today's weight as ONE weight log, and a goal exactly as My Goal does", () => {
    expect(aboutYouForm).toContain('from("athlete_profile_details").upsert(profileRow, { onConflict: "athlete_id" })');
    expect(aboutYouForm).toContain('from("body_weight_logs")');
    expect(aboutYouForm).toContain('onConflict: "athlete_id,logged_date"');
    expect(aboutYouForm).toContain('from("client_goals").insert({ athlete_id: athleteId, group_id: groupId, goal_type: goal, created_by: athleteId })');
  });
  it("a weight is read once from what was typed and body fat is not wiped by leaving it blank", () => {
    expect(aboutYouForm).toContain("parseWeightInput(weight, unit)");
    expect(aboutYouForm).toContain("if (bodyFat.trim() || initial.bodyFatPct != null)");
  });
  it("is reached from a one-time Home card and from Settings", () => {
    expect(home).toContain("<AboutYouCard");
    expect(home).toContain("aboutYouNeeded && !isCoach && !isActingAsOther");
    expect(aboutYouCard).toContain("spotlight.aboutYou.dismissed.v1");
    expect(settings).toContain("/about-you");
  });
});

describe("the coach's side of Targets", () => {
  it("edits the calculator's inputs only through the database function", () => {
    expect(bodyEditor).toContain('supabase.rpc("coach_set_body_profile"');
    expect(bodyEditor).not.toContain('from("athlete_profile_details")');
  });
  it("the starting target is a suggestion the coach reviews, never applied by itself", () => {
    expect(baselinePrompt).toContain('kind: "baseline"');
    expect(baselinePrompt).toContain('status: "pending"');
    expect(baselinePrompt).not.toContain("applyStandingTarget");
    expect(clientNutrition).toContain("<BaselinePrompt");
    expect(clientNutrition).toContain("chooseBaselinePhase(");
  });
  it("applying a starting target records a baseline check-in and gives a client with no phase the phase it was worked out for", () => {
    expect(suggestionCard).toContain('kind: "baseline"');
    expect(suggestionCard).toContain("ensurePhasePlan(supabase");
  });
  it("the phase of record replaces the old tag control and writes the milestone tag with it", () => {
    expect(clientNutrition).toContain("<PhaseOfRecordCard");
    expect(clientNutrition).not.toContain("<NutritionPhaseControl");
    expect(phaseCard).toContain("savePhasePlan(supabase");
    expect(phaseWrite).toContain('from("client_phase_plans")');
    expect(phaseWrite).toContain('from("nutrition_phases")');
    expect(phaseWrite).toContain("phaseToMilestoneTag");
  });
  it("the weekly panel starts from the phase of record and holds a minor's cut", () => {
    expect(clientNutrition).toContain("defaultPhase={phasePlan?.phase ?? derivedPhase?.phase");
    expect(panel).toContain("holdDeficitForMinor(");
    expect(panel).toContain("defaultPhase ?? lastCheckin?.phase");
  });
});

describe("the weekly job", () => {
  it("uses real adherence by date keys, not an assumed 7 of 7", () => {
    expect(cron).toContain("summarizeAdherence(");
    expect(cron).toContain("adherenceDays: adherence.daysLogged");
    expect(cron).not.toContain("AUTOMATED_ADHERENCE_DAYS");
  });
  it("carries the phase of record on a suggestion and never changes it", () => {
    expect(cron).toContain('from("client_phase_plans")');
    expect(cron).toContain("planByKey.get(`${athleteId}|${last.group_id}`)?.phase ?? last.phase");
    expect(cron).not.toMatch(/phase:\s*(?!phase)['"]/);
  });
  it("reads the date of birth from the one reader and holds a minor's cut", () => {
    expect(cron).toContain("readDateOfBirth(body)");
    expect(cron).toContain("holdDeficitForMinor(");
  });
  it("seeds a starting target for a client with no check-in and no standing target, once, and makes nothing from incomplete numbers", () => {
    expect(cron).toContain("seedBaselines(");
    expect(cron).toContain("hadBaseline.has(key)");
    expect(cron).toContain("if (!outcome.ok) return false;");
  });
});

describe("units", () => {
  it("the client's weight log is typed and shown in their unit and stored once as pounds", () => {
    expect(weightWidget).toContain("parseWeightInput(weight, weightUnit)");
    expect(weightWidget).toContain("formatWeight(todayLog.weight, weightUnit)");
  });
  it("the coach's weekly panel, the calculator and the food week follow the client's unit", () => {
    expect(clientNutrition).toContain("weightUnit={bodyProfile.weightUnit}");
    expect(panel).toContain("toLbs(prevWeight)");
  });
});
