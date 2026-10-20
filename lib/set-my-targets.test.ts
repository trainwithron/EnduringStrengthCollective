import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { saveStandingTarget, fetchStandingHistory } from "./standing-macros";
import { recalcPromptFor } from "./recalc-prompt";
import { coachRowsOnly, type StandingHistory } from "./macro-resolution";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
const { targetFromMaintenance, offerMaintenance } = await import("@/components/athlete/set-my-targets-card");

// Ron, Oct 20: "Nutrition Page set my targets option. It should give you, if your coach hasn't assigned, maybe a macro calculator and then a way to actually find your real macros."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const page = read("app/(coach)/groups/[groupId]/nutrition/page.tsx");

function recorder(error: { message: string; code?: string } | null = null) {
  const calls: { op: string; payload?: unknown }[] = [];
  const chain = (op: string, payload?: unknown): any => {
    calls.push({ op, payload });
    const c: any = { eq: () => c, gt: () => c, in: () => c, order: () => c, select: () => c, then: (res: any) => res({ data: [], error: op === "upsert" ? error : null }) };
    return c;
  };
  return { calls, client: { from: () => ({ upsert: (p: unknown) => chain("upsert", p), delete: () => chain("delete") }) } as any };
}

describe("saving a target says who set it", () => {
  it("a client's own save sends set_by 'self'", async () => {
    const r = recorder();
    await saveStandingTarget(r.client, { athleteId: "a", groupId: "g", userId: "a", target: { calories: 2400, proteinG: 160, carbsG: 250, fatG: 80 }, today: "2026-10-20", setBy: "self" });
    expect((r.calls[0].payload as { set_by?: string }).set_by).toBe("self");
  });
  it("a coach's save leaves it out (the column default and the database guard make it the coach's), so it works before and after the update", async () => {
    const r = recorder();
    await saveStandingTarget(r.client, { athleteId: "a", groupId: "g", userId: "c", target: { calories: 2400, proteinG: 160, carbsG: 250, fatG: 80 }, today: "2026-10-20" });
    expect(r.calls[0].payload).not.toHaveProperty("set_by");
  });
  it("a client's own save never falls back to the old single-row table", async () => {
    const r = recorder({ message: "relation does not exist", code: "42P01" });
    const out = await saveStandingTarget(r.client, { athleteId: "a", groupId: "g", userId: "a", target: { calories: 2400, proteinG: 160, carbsG: 250, fatG: 80 }, today: "2026-10-20", setBy: "self" });
    expect(out).toEqual({ ok: false });
  });
  it("reading the history before the database update still works (every row is then the coach's)", async () => {
    let n = 0;
    const client: any = {
      from: () => {
        const c: any = { select: (cols: string) => ((c.cols = cols), c), in: () => c, order: () => c, eq: () => c };
        c.then = (res: any) => {
          n++;
          return res(c.cols.includes("set_by") ? { data: null, error: { message: 'column client_macro_target_history.set_by does not exist' } } : { data: [{ athlete_id: "a", effective_from: "2026-10-01", calories: 2000, protein_g: 150, carbs_g: null, fat_g: null }], error: null });
        };
        return c;
      },
    };
    const h = await fetchStandingHistory(client, "a", "g");
    expect(h).toEqual([{ effective_from: "2026-10-01", calories: 2000, protein_g: 150, carbs_g: null, fat_g: null, set_by: "coach" }]);
    expect(n).toBe(2);
  });
});

describe("a client's own target is never the coach's", () => {
  const history: StandingHistory = [
    { effective_from: "2026-10-01", calories: 2000, protein_g: 150, carbs_g: null, fat_g: null, set_by: "coach" },
    { effective_from: "2026-10-18", calories: 2400, protein_g: 150, carbs_g: null, fat_g: null, set_by: "self" },
  ];
  it("the 'are you happy with your meal plan?' question ignores the client's own change", () => {
    expect(recalcPromptFor(history, [], "2026-10-20")).not.toBeNull();
    expect(recalcPromptFor(coachRowsOnly(history), [], "2026-10-20")).toBeNull();
    expect(page).toContain("recalcPromptFor(coachRowsOnly(standingHistory),");
  });
  it("the weekly job counts only coach targets as 'has a target'", () => {
    expect(read("app/api/cron/nutrition-checkin-suggestions/route.ts")).toContain('.select("athlete_id, group_id").eq("set_by", "coach")');
  });
  it("the coach sees 'Set by <name> themselves'", () => {
    expect(read("components/coach/desktop/standing-macro-target-card.tsx")).toContain("{saved ? (setByClient ? `Set by ${clientName} themselves` : \"Active\") : \"Not set\"}");
    expect(read("components/coach/nutrition/client-nutrition.tsx")).toContain('setByClient={standingTarget?.set_by === "self"}');
  });
});

describe("Find my real maintenance as a target", () => {
  it("keeps protein and fills carbs and fat in the current ratio", () => {
    const t = targetFromMaintenance(2750, { calories: 2400, proteinG: 160, carbsG: 250, fatG: 80 }, 150);
    expect(t.calories).toBe(2750);
    expect(t.proteinG).toBe(160);
    // 2,750 - 640 = 2,110 in the same 1,000 : 720 split
    expect(t.carbsG).toBe(Math.round((2110 * 1000) / 1720 / 4));
    expect(t.fatG).toBe(Math.round((2110 * 720) / 1720 / 9));
  });
  it("offered only when it differs from the current target by 100 or more (or there is none)", () => {
    expect(offerMaintenance(2450, { calories: 2400, proteinG: 1, carbsG: 1, fatG: 1 })).toBe(false);
    expect(offerMaintenance(2500, { calories: 2400, proteinG: 1, carbsG: 1, fatG: 1 })).toBe(true);
    expect(offerMaintenance(2500, null)).toBe(true);
  });
});

describe("where Set my targets shows", () => {
  it("replaces 'No targets set for today yet' only when the coach has nothing in force", () => {
    expect(page).toContain(
      "macrosEnabled && coachSetsMacros && !youthMode && ownSpace && coachRowsOnly(standingHistory).length === 0 && !todayMacroRow && !(todayMealPlan?.macros as unknown);"
    );
    expect(page).toContain(") : setMyTargets ? null : (\n              <p className=\"font-body text-sm text-steel\">No targets set for today yet.</p>");
  });
  it("never for a coach acting as a client, but in the coach's own personal space", () => {
    expect(page).toContain("const ownSpace = !isActingAsOther || athleteId === user.id;");
  });
  it("no fat-loss goal under 18 or with no date of birth; the calculator uses Mifflin-St Jeor / Katch-McArdle when About you is complete", () => {
    expect(page).toContain("hideFatLoss: age == null || age < 18,");
    expect(page).toContain("baselineMaintenance: baseline.ok ? baseline.maintenance : null,");
    const calc = read("components/tools/macro-calculator.tsx");
    expect(calc).toContain('const goals = hideFatLoss ? GOAL_OPTIONS.filter((o) => o.value !== "fat_loss") : GOAL_OPTIONS;');
    expect(calc).toContain("maintenanceOverride != null && maintenanceOverride > 0 ? maintenanceOverride : estimateMaintenanceCalories(weightNum, activity)");
  });
  it("saves as the client's own target", () => {
    expect(read("components/athlete/set-my-targets-card.tsx")).toContain('saveStandingTarget(supabase, { athleteId, groupId, userId: user?.id ?? null, target, today: todayKey, setBy: "self" })');
  });
});
