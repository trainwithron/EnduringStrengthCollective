import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { GeneratedMeal } from "@/lib/meal-engine";
import { dateKeyInZone, DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";

// calorie_tracking_ux_research_and_plan.md — the guardian-visibility
// page. Deliberately reads through the service-role client only, keyed
// on the exact token in the URL (never an anon RLS grant on
// meal_plans/food_log_entries) — same "public page, single service-role
// lookup" pattern already used for lib/shared-milestone.ts and
// lib/shared-workout.ts. Never surfaces raw macro/calorie numbers, same
// restraint those two already apply to weight/calories — a caregiver
// gets status, not data.
export type GuardianMealStatus = "ate_it" | "modified" | "skipped" | "not_logged";

export interface GuardianMeal {
  title: string;
  status: GuardianMealStatus;
}

export interface GuardianView {
  athleteName: string;
  groupName: string;
  dateLabel: string;
  meals: GuardianMeal[];
  proteinUnderTarget: boolean;
}

// Under 13 on the given calendar day ("YYYY-MM-DD"), the same line the app and the database use.
export function underThirteenOn(dateOfBirth: string, todayKey: string): boolean {
  const [y, m, d] = todayKey.split("-");
  return dateOfBirth > `${Number(y) - 13}-${m}-${d}`;
}

export async function getGuardianView(token: string): Promise<GuardianView | null> {
  const supabase = createServiceRoleClient();

  const { data: link } = await supabase
    .from("guardian_links")
    .select("athlete_id, group_id, created_by, revoked_at, expires_at")
    .eq("access_token", token)
    .maybeSingle();

  // Revoked, or past its expiry (a link with no expiry date is not trusted).
  if (!link || link.revoked_at) return null;
  if (!link.expires_at || new Date(link.expires_at).getTime() <= Date.now()) return null;

  // Checked again on every visit, not just when the link was made: the child must still be a client in this group and still under 13, and the coach who made the link must still coach it.
  const [{ data: profile }, { data: group }, { data: athleteMember }, { data: coachMember }, { data: coachProfile }, { data: intake }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", link.athlete_id).maybeSingle(),
    supabase.from("groups").select("name").eq("id", link.group_id).maybeSingle(),
    supabase.from("group_memberships").select("role").eq("group_id", link.group_id).eq("profile_id", link.athlete_id).maybeSingle(),
    supabase.from("group_memberships").select("role").eq("group_id", link.group_id).eq("profile_id", link.created_by).maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", link.created_by).maybeSingle(),
    supabase.from("client_intake").select("date_of_birth").eq("athlete_id", link.athlete_id).maybeSingle(),
  ]);
  if (athleteMember?.role !== "athlete" || coachMember?.role !== "coach") return null;

  // "Today" is the day in the coach's business time zone, not UTC.
  const zone = isValidTimeZone(coachProfile?.timezone) ? coachProfile.timezone : DEFAULT_COACH_TIMEZONE;
  const todayKey = dateKeyInZone(zone);
  if (!intake?.date_of_birth || !underThirteenOn(intake.date_of_birth, todayKey)) return null;

  const [{ data: mealPlan }, { data: logRows }] = await Promise.all([
    supabase
      .from("meal_plans")
      .select("meals")
      .eq("athlete_id", link.athlete_id)
      .eq("log_date", todayKey)
      .maybeSingle(),
    supabase
      .from("food_log_entries")
      .select("meal_slot, status, protein_g")
      .eq("athlete_id", link.athlete_id)
      .eq("log_date", todayKey),
  ]);

  const generatedMeals = ((mealPlan?.meals as unknown) ?? []) as GeneratedMeal[];
  const statusBySlot = new Map((logRows ?? []).map((r) => [r.meal_slot, r.status as string]));

  const meals: GuardianMeal[] = generatedMeals.map((m) => {
    const status = statusBySlot.get(m.spec.id);
    return {
      title: m.spec.title,
      status:
        status === "ate_it" || status === "modified" || status === "skipped" ? status : "not_logged",
    };
  });

  // A coarse boolean only, never the numbers behind it. Only fires once
  // at least one meal has actually been resolved today (logging nothing
  // yet is "early in the day," not "under target") and only when what
  // was actually eaten (ate_it/modified — skipped/not-logged genuinely
  // contributed 0) meaningfully trails the day's own prescribed total.
  const anyResolved = (logRows ?? []).length > 0;
  const prescribedProtein = generatedMeals.reduce((sum, m) => sum + m.spec.proteinTarget, 0);
  const loggedProtein = (logRows ?? [])
    .filter((r) => r.status === "ate_it" || r.status === "modified")
    .reduce((sum, r) => sum + (r.protein_g ?? 0), 0);
  const proteinUnderTarget = anyResolved && prescribedProtein > 0 && loggedProtein < prescribedProtein * 0.7;

  return {
    athleteName: profile?.full_name ?? "This athlete",
    groupName: group?.name ?? "Their team",
    dateLabel: new Date(`${todayKey}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    meals,
    proteinUnderTarget,
  };
}
