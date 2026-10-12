import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadShareIdentity } from "@/lib/share-identity";

// Milestone Celebrations, flagship — the public celebration surface for
// a reverse-diet milestone. Deliberately reads through the service-role
// client only, scoped to the ONE exact id in the URL (never an anon
// RLS grant on milestone_events) — the same "public page, single
// service-role lookup" pattern already used for the sensitive signals
// inside lib/shared-workout.ts. Never surfaces raw calorie targets or
// the athlete's literal weight — only the relative "expected vs actual"
// framing, same privacy restraint already applied to the relative-
// strength milestone's bodyweight number.
export async function getSharedMilestone(milestoneId: string) {
  const supabase = createServiceRoleClient();

  const { data: event } = await supabase
    .from("milestone_events")
    .select("id, athlete_id, group_id, milestone_type, detail, detected_at")
    .eq("id", milestoneId)
    .maybeSingle();

  if (!event) return null;
  if (
    event.milestone_type !== "reverse_diet" &&
    event.milestone_type !== "recovery_volume" &&
    event.milestone_type !== "phase_alignment"
  ) {
    return null;
  }

  // The name a stranger sees follows the client's own setting and the under-18 default; a one-on-one space shows the business name; nothing is shown for a client under 18.
  const identity = await loadShareIdentity(supabase, event.athlete_id, event.group_id);
  if (identity.isMinor) return null;
  const { athleteName, groupName } = identity;

  if (event.milestone_type === "reverse_diet") {
    const detail = event.detail as {
      calorieIncrease: number;
      weightChangePct: number;
      weeklyExpectedGainLbs: number;
      windowWeeks: number;
    };
    return {
      id: event.id,
      milestoneType: "reverse_diet" as const,
      athleteName,
      groupName,
      weeklyExpectedGainLbs: detail.weeklyExpectedGainLbs,
      weightTrendedDown: detail.weightChangePct <= -1,
      windowWeeks: detail.windowWeeks,
      detectedAt: event.detected_at as string,
    };
  }

  if (event.milestone_type === "recovery_volume") {
    const detail = event.detail as { readinessChangePct: number; volumeChangePct: number; windowWeeks: number };
    return {
      id: event.id,
      milestoneType: "recovery_volume" as const,
      athleteName,
      groupName,
      readinessChangePct: detail.readinessChangePct,
      volumeChangePct: detail.volumeChangePct,
      windowWeeks: detail.windowWeeks,
      detectedAt: event.detected_at as string,
    };
  }

  const detail = event.detail as {
    phase: "cut" | "bulk";
    calorieChangePct: number;
    weightChangePct: number;
    windowWeeks: number;
  };
  return {
    id: event.id,
    milestoneType: "phase_alignment" as const,
    athleteName,
    groupName,
    phase: detail.phase,
    calorieChangePct: detail.calorieChangePct,
    weightChangePct: detail.weightChangePct,
    windowWeeks: detail.windowWeeks,
    detectedAt: event.detected_at as string,
  };
}

export type SharedMilestone = NonNullable<Awaited<ReturnType<typeof getSharedMilestone>>>;
