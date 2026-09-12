import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeWeekStreak } from "@/lib/consistency-streak";
import { formatJourneyDuration, formatWeightChange } from "@/lib/journey-recap";

// Milestone Celebrations, piece D — "your journey so far." Unlike every
// other card in this thread, this is always-available on demand, not
// triggered by a cron or a workout completion — computed live from
// whatever real history already exists, the moment someone opens the
// link. Same "public page, one service-role read, no anon RLS grant"
// pattern already used for the other milestone surfaces; the id in the
// URL is the athlete's own profile id (a UUID, unguessable — same
// threat model as every other id-addressed public page in this app).
export async function getJourneyRecap(athleteId: string) {
  const supabase = createServiceRoleClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", athleteId)
    .maybeSingle();
  if (!profile) return null;

  const { data: logs } = await supabase
    .from("workout_logs")
    .select("created_at, total_volume, new_prs")
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: true });

  // No real logged history yet — nothing to recap, so this page just
  // isn't available rather than showing an all-zeroes card.
  if (!logs || logs.length === 0) return null;

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("group_id, groups ( name )")
    .eq("profile_id", athleteId)
    .eq("role", "athlete")
    .limit(1)
    .maybeSingle();

  const now = new Date();
  const firstWorkoutDate = new Date(logs[0].created_at);
  const totalVolume = logs.reduce((sum, l) => sum + (l.total_volume ?? 0), 0);
  const totalPrCount = logs.reduce((sum, l) => sum + (l.new_prs?.length ?? 0), 0);

  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const recentLogDates = logs
    .map((l) => new Date(l.created_at))
    .filter((d) => d >= twoYearsAgo);
  const weekStreak = computeWeekStreak(recentLogDates, now);

  const { data: weightRows } = await supabase
    .from("body_weight_logs")
    .select("logged_date, weight")
    .eq("athlete_id", athleteId)
    .order("logged_date", { ascending: true });

  let weightChangeLabel: string | null = null;
  if (weightRows && weightRows.length >= 2) {
    const delta = weightRows[weightRows.length - 1].weight - weightRows[0].weight;
    weightChangeLabel = formatWeightChange(delta);
  }

  return {
    athleteId,
    athleteName: profile.full_name ?? "An athlete",
    groupName: (membership as any)?.groups?.name ?? "The Enduring Strength Collective",
    journeyDuration: formatJourneyDuration(firstWorkoutDate, now),
    totalVolume: Math.round(totalVolume),
    totalWorkoutCount: logs.length,
    totalPrCount,
    weekStreak,
    weightChangeLabel,
  };
}

export type JourneyRecap = NonNullable<Awaited<ReturnType<typeof getJourneyRecap>>>;
