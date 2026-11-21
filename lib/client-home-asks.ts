import type { SupabaseClient } from "@supabase/supabase-js";
import { dateKeyInZone } from "@/lib/timezone";
import { goalReviewDue, goalReviewText } from "@/lib/goal-review";
import { checkinWeekStart, isCheckinCardDay } from "@/lib/weekly-checkin";
import { checkinTimezone, loadOwnCheckin } from "@/lib/weekly-checkin-server";

// Two things a client's Home asks of them (read only for the client themselves, never for a coach looking through their app):
// - goalReview: their goal sheet was answered or last confirmed 90 days ago or more (R5), with the goal in their own words
// - checkinCard: it is Friday to Monday where they are and this week's check-in is not sent (R2): "due"; or it is sent and the coach has not reviewed it yet: "sent"
//   (audit C2, Nov 21: the card stays as "Sent, change it" so the client can get back to it)
// A read that fails just leaves its card out; a database without step 215 shows neither.
export interface ClientHomeAsks {
  goalReview: { text: string | null } | null;
  checkinCard: CheckinCardState;
}

export type CheckinCardState = false | "due" | "sent";

export function checkinCardState(own: { available: boolean; row: { reviewed_at: string | null } | null }): CheckinCardState {
  if (!own.available) return false;
  if (!own.row) return "due";
  return own.row.reviewed_at ? false : "sent";
}

export async function loadClientHomeAsks(supabase: SupabaseClient, { athleteId, groupId, now = new Date() }: { athleteId: string; groupId: string; now?: Date }): Promise<ClientHomeAsks> {
  const [goalReview, checkinCard] = await Promise.all([
    (async () => {
      const { data, error } = await supabase.from("client_goal_sheets").select("filled_at, reviewed_at, success_90_days, why_matters").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle();
      if (error || !data) return null;
      const row = data as { filled_at: string | null; reviewed_at: string | null; success_90_days: string | null; why_matters: string | null };
      return goalReviewDue(row, now) ? { text: goalReviewText(row) } : null;
    })().catch(() => null),
    (async () => {
      const tz = await checkinTimezone(supabase, athleteId, groupId);
      const today = dateKeyInZone(tz, now);
      if (!isCheckinCardDay(today)) return false;
      const own = await loadOwnCheckin(supabase, athleteId, groupId, checkinWeekStart(today));
      return checkinCardState(own);
    })().catch((): CheckinCardState => false),
  ]);
  return { goalReview, checkinCard };
}
