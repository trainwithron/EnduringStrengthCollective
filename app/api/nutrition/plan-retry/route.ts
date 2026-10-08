import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { loadLibraryContext } from "@/lib/library-data";
import { buildSelectionContext } from "@/lib/library-meal-plan";
import { MAX_PLAN_TRIES, mergeTastes, planChanged, readRetryNote, rebuildRows, retryDays, rulesForRetry, triesUsed, type ExistingPlanRow } from "@/lib/meal-plan-retry";
import { preferencesToRow, rowToPreferences } from "@/lib/nutrition-preferences";

export const maxDuration = 60;

// A client asks for a different meal plan. The rebuild is automatic and uses the recipe library only: nothing the client typed is sent to an AI. What they typed is read with the
// same rule-based reader the coach's restrictions note uses, saved as foods they avoid or like, and used to rebuild the days from today on that the library built. The database
// function counts the tries (3 per plan), never touches a day the coach built by hand, keeps a copy of the plan from before, and tells the coach.

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated", 401);

  let body: { groupId?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Bad request", 400);
  }
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  if (!groupId) return fail("Bad request", 400);

  // Only the client themself (a coach "acting as" a client cannot ask on their behalf): they must be an athlete of this group.
  const { data: membership } = await supabase.from("group_memberships").select("role, client_tier").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (!membership || membership.role !== "athlete") return fail("Only the client can ask for a different plan.", 403);
  if ((membership.client_tier ?? null) === "group") return fail("This plan can't be changed here. Message your coach.", 403);

  const read = readRetryNote(typeof body.note === "string" ? body.note : "");
  if (!read.ok) return fail(read.message, 422);

  const service = createServiceRoleClient();
  const timezone = await getGroupCoachTimezone(service, groupId);
  const todayKey = dateKeyInZone(timezone);

  const { data: planRows, error: planError } = await service
    .from("meal_plans")
    .select("log_date, archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals, created_by")
    .eq("athlete_id", user.id)
    .eq("group_id", groupId)
    .gte("log_date", todayKey)
    .order("log_date", { ascending: true })
    .limit(62);
  if (planError) {
    console.error("[plan-retry] could not read the plan:", planError.message);
    return fail("Couldn't read your plan. Try again in a moment.", 500);
  }
  const plan = (planRows ?? []) as unknown as ExistingPlanRow[];
  if (plan.length === 0) return fail("There is no plan to change yet.", 409);
  const days = retryDays(plan, todayKey);
  if (days.rebuild.length === 0) return fail("Your coach planned these days by hand, so message them to change it.", 409);
  if (triesUsed(plan, todayKey) >= MAX_PLAN_TRIES) return fail("You've used all your tries on this plan. Message your coach.", 409);

  // Their food preferences: the saved tastes plus what they just said. Read now, saved only after the plan was changed (a request that could not be met leaves no trace).
  const { data: prefsRow, error: prefsError } = await supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", user.id).maybeSingle();
  if (prefsError) {
    console.error("[plan-retry] could not read food rules:", prefsError.message);
    return fail("Couldn't read your food preferences, so nothing was changed. Try again in a moment.", 500);
  }
  const before = rowToPreferences(prefsRow as Record<string, unknown> | null);
  const merged = mergeTastes(before, read);

  const coachId = plan[0].created_by;
  const library = await loadLibraryContext(service, { coachId, athleteId: user.id, todayKey });
  const rules = rulesForRetry({ allergies: merged.allergies, intolerances: merged.intolerances, dislikes: merged.dislikes, dietType: merged.dietType }, read);
  const rebuilt = rebuildRows({
    plan,
    // The database function takes at most 31 days at once; a plan is usually a week or two.
    days: days.rebuild.slice(0, 31),
    // The client asked for change, so meals offered lately move down whatever their usual variety setting says.
    ctxFor: (archetype) => buildSelectionContext({ libraryData: library, rules, archetype, extraLikes: read.likes, variety: "mix_it_up" }),
    rotateFeatured: true,
  });
  if (rebuilt.rows.length === 0 || rebuilt.hasEmptyMeal) {
    return fail("I couldn't find meals that fit all of that. Try changing less, or message your coach.", 422);
  }
  if (!planChanged(plan, rebuilt.rows)) {
    return fail("The library didn't have different meals that fit. Try asking for something else, or message your coach.", 422);
  }

  const { data: tryNumber, error: applyError } = await service.rpc("apply_meal_plan_try", {
    p_athlete_id: user.id,
    p_group_id: groupId,
    p_today: todayKey,
    p_rows: rebuilt.rows,
    p_note: read.text,
    p_summary: read.summary,
  });
  if (applyError) {
    const msg = applyError.message ?? "";
    if (/no_tries_left/.test(msg)) return fail("You've used all your tries on this plan. Message your coach.", 409);
    if (/hand_built/.test(msg)) return fail("Your coach just changed some days by hand. Reload and try again.", 409);
    console.error("[plan-retry] could not apply the try:", msg);
    return fail("Couldn't change your plan. Nothing was changed. Try again in a moment.", 500);
  }

  // Their own session saves it (a client may edit their tastes, never the rules that shape the numbers). The plan is already changed, so a failure here is logged, not fatal.
  let preferencesSaved = true;
  if (merged.dislikes.length !== before.dislikes.length || merged.likes.length !== before.likes.length) {
    const { error: saveError } = await supabase.from("client_nutrition_preferences").upsert(preferencesToRow(merged, user.id, { onlyTastes: true }), { onConflict: "athlete_id" });
    if (saveError) {
      preferencesSaved = false;
      console.error("[plan-retry] could not save the preferences:", saveError.message);
    }
  }

  const used = typeof tryNumber === "number" ? tryNumber : MAX_PLAN_TRIES;
  return NextResponse.json({ tryNumber: used, triesLeft: Math.max(0, MAX_PLAN_TRIES - used), daysChanged: rebuilt.rows.length, summary: read.summary, preferencesSaved }, { headers: { "Cache-Control": "no-store" } });
}
