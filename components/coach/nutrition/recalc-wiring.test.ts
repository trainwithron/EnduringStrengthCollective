import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { RecalcPromptCard } from "@/components/athlete/recalc-prompt-card";
import { ClientAnswersPanel } from "@/components/coach/nutrition/client-answers-panel";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const athletePage = src("../../../app/(coach)/groups/[groupId]/nutrition/page.tsx");
const clientNutrition = src("./client-nutrition.tsx");
const migration = src("../../../supabase/migrations/0306_target_change_notice.sql");

describe("the client's question", () => {
  const card = (over: Partial<Parameters<typeof RecalcPromptCard>[0]> = {}) =>
    renderToStaticMarkup(createElement(RecalcPromptCard, { athleteId: "a1", groupId: "g1", effectiveFrom: "2026-10-06", calories: 2100, showCalories: true, ...over }));
  it("says the new number and asks the question", () => {
    const html = card();
    expect(html).toContain("Your daily target is now 2,100 calories.");
    expect(html).toContain("Are you happy with your meal plan?");
    expect(html).toContain("Happy with it");
    expect(html).toContain("change something");
  });
  it("in youth mode the number is never shown", () => {
    const html = card({ showCalories: false });
    expect(html).not.toContain("2,100");
    expect(html).toContain("Your daily nutrition target changed.");
  });
  it("is shown only to the client themself, only when a real change is unanswered", () => {
    expect(athletePage).toContain("macrosEnabled && !isActingAsOther");
    expect(athletePage).toContain("recalcPromptFor(standingHistory");
    expect(athletePage).toContain("<RecalcPromptCard");
    expect(athletePage).toContain("showCalories={!youthMode}");
  });
});

describe("the coach's panel", () => {
  const answer = (over = {}) => ({ id: "f1", happy: false, changeText: "too much chicken", requestsText: "", boring: true, status: "new" as const, targetEffectiveFrom: "2026-10-06", createdAt: "2026-10-06T12:00:00Z", ...over });
  const panel = (answers: ReturnType<typeof answer>[], over = {}) =>
    renderToStaticMarkup(
      createElement(ClientAnswersPanel, { athleteId: "a1", clientName: "Sam", answers, variety: "few_favorites", currentTarget: { calories: 2100, protein: 168, carbs: 210, fats: 63 }, todayKey: "2026-10-08", metric: false, ...over })
    );
  it("shows what the client said and the actions", () => {
    const html = panel([answer()]);
    expect(html).toContain("Client answers");
    expect(html).toContain("too much chicken");
    expect(html).toContain("Says the plan is getting boring.");
    expect(html).toContain("Mark handled");
    expect(html).toContain("Scale my plan to the new target");
    expect(html).toContain("Rebuild with their requests");
    expect(html).toContain("More variety");
  });
  it("no variety button unless the client called it boring, and none at the top step", () => {
    expect(panel([answer({ boring: false })])).not.toContain("More variety");
    expect(panel([answer()], { variety: "mix_it_up" })).toContain("already");
  });
  it("shows nothing when the client has answered nothing, and counts handled ones quietly", () => {
    expect(panel([])).toBe("");
    const html = panel([answer({ status: "handled" })]);
    expect(html).toContain("1 earlier answer handled.");
    expect(html).not.toContain("Scale my plan");
  });
  it("scaling is off when there is no target in force", () => {
    expect(panel([answer()], { currentTarget: null })).toMatch(/disabled=""[^>]*>Scale my plan|Scale my plan[^<]*<\/button>/);
  });
  it("sits at the top of the Preferences section and reads the client's answers", () => {
    expect(clientNutrition).toContain("<ClientAnswersPanel");
    expect(clientNutrition).toContain('.from("client_nutrition_feedback")');
    expect(clientNutrition.indexOf("<ClientAnswersPanel")).toBeGreaterThan(clientNutrition.indexOf('title="Preferences"'));
    expect(clientNutrition.indexOf("<ClientAnswersPanel")).toBeLessThan(clientNutrition.indexOf("<PreferencesSection"));
  });
});

describe("the bell notice", () => {
  it("has fixed wording with no numbers and no free text, and tells only the client", () => {
    expect(migration).toContain("'Your daily nutrition target changed. Take a look at your meal plan and tell your coach if you are happy with it.'");
    expect(migration).toContain("values (new.athlete_id, new.group_id, 'nutrition_target_changed'");
    expect(migration).toContain("v_prev is null or v_prev = new.calories");
  });
});
