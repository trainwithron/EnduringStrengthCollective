import type { SupabaseClient } from "@supabase/supabase-js";
import { readPushPrefs } from "@/lib/push-prefs";
import { dateKeyInZone } from "@/lib/timezone";
import { CHECKIN_GAP_DAYS, cardMessage, checkinIsOpen } from "@/lib/food-checkin";

// What the client's Nutrition and Home pages show (Nov 24): their coach's open food check-in in this group, unless they said "Not now" today (their own calendar). Read as the
// client (row security shows them only their own). Nothing when there is none, or the read fails.
export interface OpenFoodCheckin {
  id: string;
  coachFirstName: string;
  message: string;
}

export async function loadOpenFoodCheckin(supabase: SupabaseClient, athleteId: string, groupId: string): Promise<OpenFoodCheckin | null> {
  try {
    const { data } = await supabase
      .from("client_food_checkins")
      .select("id, status, sent_at, trigger, avg_diff_kcal, not_now_on, coach_id, profiles!client_food_checkins_coach_id_fkey ( full_name )")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .eq("status", "sent")
      .gte("sent_at", new Date(Date.now() - CHECKIN_GAP_DAYS * 86400000).toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as {
      id: string;
      status: string;
      sent_at: string;
      trigger: string;
      avg_diff_kcal: number | null;
      not_now_on: string | null;
      profiles: { full_name: string | null } | { full_name: string | null }[] | null;
    } | null;
    if (!row || !checkinIsOpen(row, new Date())) return null;
    if (row.not_now_on) {
      const today = dateKeyInZone((await readPushPrefs(supabase, athleteId)).timeZone);
      if (row.not_now_on === today) return null;
    }
    const coach = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const { data: me } = await supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
    const clientName = ((me as { full_name?: string | null } | null)?.full_name ?? null);
    return { id: row.id, coachFirstName: (coach?.full_name ?? "").trim().split(/\s+/)[0] || "Your coach", message: cardMessage(row, clientName) };
  } catch {
    return null;
  }
}
