import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { addDaysToKey } from "@/lib/date-key";
import { loadLibraryContext } from "@/lib/library-data";
import { buildSelectionContext, choiceFromOption, optionFromScaled } from "@/lib/library-meal-plan";
import { selectOptions } from "@/lib/library-selection";
import { rateLimitResponse } from "@/lib/rate-limit";
import { rowToPreferences } from "@/lib/nutrition-preferences";
import { emptyMealKey, fillEmptyMeals, planAllergySwaps, rebuildNotice, safeDays, stillEmpty, type ConflictPlanRow } from "@/lib/allergy-conflict-rebuild";
import { choiceFromVerified, suggestMealSlotOptions } from "@/lib/ai-meal-slot";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { AiNotConfiguredError } from "@/lib/anthropic-client";
import type { MealRecipeChoice } from "@/lib/meal-plan-assignment";
import type { FoodRules } from "@/lib/allergen-check";

export const maxDuration = 120;

// Called right after a client saves their allergies or foods they avoid (the first-visit question, or My food preferences). The rules are read again HERE, from the saved row (never from
// what the browser sent), and every assigned day from today on is checked. Only the options that now break a rule are swapped (lib/allergy-conflict-rebuild.ts): from the coach's recipe
// library first; a meal left with no option at all is offered to the AI (the same checked pipeline as the coach's planner, charged to the coach's AI budget). Every option is checked once more
// before anything is written, and a day that would still break a rule is not written. The database function (0430) keeps a copy, changes only those days' meals, never counts as one of the
// client's 3 tries, and tells the coach. Nothing here unhides anything: the client's screen already hides a flagged option until it is replaced.

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const AI_ARCHETYPES = ["omnivore", "vegetarian", "vegan", "carnivore", "keto", "paleo"];
// A run asks the AI for at most this many meals (each is one call on the coach's budget); the rest stay hidden and the coach is asked.
const MAX_AI_MEALS = 6;

export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated", 401);
  const limited = await rateLimitResponse("allergy-rebuild", user.id, 10, 3600);
  if (limited) return limited;

  // Their own saved rules, through their own session. Unreadable: nothing is done (their screen hides every option until the rules can be read).
  const { data: prefsRow, error: prefsError } = await supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", user.id).maybeSingle();
  if (prefsError) {
    console.error("[allergy-rebuild] could not read food rules:", prefsError.message);
    return fail("Couldn't read your food answers, so your plan was not changed.", 500);
  }
  if (!prefsRow) return NextResponse.json({ daysChanged: 0, mealsNeedingCoach: 0 }, { headers: { "Cache-Control": "no-store" } });
  const prefs = rowToPreferences(prefsRow as Record<string, unknown>);
  const rules: FoodRules = { allergies: prefs.allergies, intolerances: prefs.intolerances, dislikes: prefs.dislikes, dietType: prefs.dietType };

  const service = createServiceRoleClient();
  // The plan days from yesterday on (each group's own "today" is worked out below), in the groups where they are a client.
  const { data: seats } = await service.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "athlete");
  const groupIds = (seats ?? []).map((s) => s.group_id as string);
  if (groupIds.length === 0) return NextResponse.json({ daysChanged: 0, mealsNeedingCoach: 0 }, { headers: { "Cache-Control": "no-store" } });
  const { data: allPlanRows, error: planError } = await service
    .from("meal_plans")
    .select("log_date, group_id, archetype, meals, created_by")
    .eq("athlete_id", user.id)
    .gte("log_date", addDaysToKey(new Date().toISOString().slice(0, 10), -1))
    .order("log_date", { ascending: true })
    .limit(120);
  if (planError) {
    console.error("[allergy-rebuild] could not read the plan:", planError.message);
    return fail("Couldn't read your plan. Your coach can still see what to change.", 500);
  }
  const planRows = (allPlanRows ?? []).filter((r) => groupIds.includes(r.group_id as string));
  const { data: me } = await service.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const firstName = ((me?.full_name as string | null) ?? "").trim().split(/\s+/)[0] || "Your client";

  let daysChanged = 0;
  let mealsNeedingCoach = 0;
  let aiLeft = MAX_AI_MEALS;
  let aiStopped = false;
  const byGroup = new Map<string, { log_date: string; group_id: string; archetype: string; meals: unknown; created_by: string }[]>();
  for (const r of planRows as { log_date: string; group_id: string; archetype: string; meals: unknown; created_by: string }[]) byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r]);

  for (const [groupId, rows] of byGroup) {
    const todayKey = dateKeyInZone(await getGroupCoachTimezone(service, groupId));
    const days = rows.filter((r) => r.log_date >= todayKey).slice(0, 31);
    if (days.length === 0) continue;
    const coachId = days[0].created_by;
    const library = await loadLibraryContext(service, { coachId, athleteId: user.id, todayKey });
    const contexts = new Map<string, ReturnType<typeof buildSelectionContext>>();
    const ctxFor = (archetype: string) => {
      if (!contexts.has(archetype)) contexts.set(archetype, buildSelectionContext({ libraryData: library, rules, archetype }));
      return contexts.get(archetype)!;
    };
    const plan = planAllergySwaps(days as unknown as ConflictPlanRow[], rules, todayKey, (slot, target, excludeKeys, count, archetype): MealRecipeChoice[] =>
      selectOptions(slot, target, { ...ctxFor(archetype), excludeKeys }, count).options.map((m) => choiceFromOption(optionFromScaled(m)))
    );
    if (plan.days.length === 0) continue;

    // A meal the library could not fill: the AI, a few at a time, on the coach's budget. A limit or an outage stops asking; those meals stay hidden and the coach is asked.
    const filled = new Map<string, MealRecipeChoice[]>();
    for (const e of plan.emptyMeals) {
      if (aiStopped || aiLeft <= 0) break;
      aiLeft--;
      try {
        const diet = rules.dietType ?? "";
        const archetype = AI_ARCHETYPES.includes(diet) ? diet : AI_ARCHETYPES.includes(e.archetype) ? e.archetype : "omnivore";
        const res = await suggestMealSlotOptions(service, {
          meta: { feature: "meal_plan_slot", userId: user.id, coachId },
          mealSlot: e.slot,
          proteinTarget: e.target.proteinG,
          carbsTarget: e.target.carbsG,
          fatTarget: e.target.fatG,
          archetype,
          rules,
        });
        const choices = res.options.map(choiceFromVerified);
        if (choices.length > 0) filled.set(emptyMealKey(e), choices);
      } catch (err) {
        if (err instanceof AiRateLimitedError || err instanceof AiNotConfiguredError) aiStopped = true;
        else console.error("[allergy-rebuild] AI meal failed:", err instanceof Error ? err.message : err);
      }
    }
    fillEmptyMeals(plan, filled);

    // The last check, whatever each option's source: a day that would still break a rule is not written.
    const { safe, unsafe } = safeDays(plan, rules);
    if (unsafe.length > 0) console.error("[allergy-rebuild] days left as they were (still breaking a rule):", unsafe.join(", "));
    if (safe.length === 0) continue;
    const needing = stillEmpty({ ...plan, days: safe }).length;
    const { data: changed, error: applyError } = await service.rpc("apply_allergy_rebuild", {
      p_athlete_id: user.id,
      p_group_id: groupId,
      p_today: todayKey,
      p_rows: safe.map((d) => ({ log_date: d.log_date, meals: d.meals })),
      p_notice: rebuildNotice(firstName, plan, safe.length, needing),
    });
    if (applyError) {
      console.error("[allergy-rebuild] could not apply:", applyError.message);
      continue;
    }
    daysChanged += typeof changed === "number" ? changed : 0;
    mealsNeedingCoach += needing;
  }

  return NextResponse.json({ daysChanged, mealsNeedingCoach }, { headers: { "Cache-Control": "no-store" } });
}
