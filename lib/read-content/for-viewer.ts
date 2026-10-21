import type { SupabaseClient } from "@supabase/supabase-js";
import { FAITH_PACK, pickDailyItem, withCoachPassages, type ReadItem } from "@/lib/read-content";

// What the rest timer needs to show "Read": the passage for this person today, and whether they have seen the one-time note. Null means Read is not offered at all
// (turned off by the client, turned off by a coach for all their clients, or the lookup failed: Read never blocks a workout).
export interface ReadForViewer {
  ref: string;
  text: string;
  noteSeen: boolean;
}

// The passages the coaches of this group added themselves (coach_read_passages, 0431): they join the cycle. A failed read (or a database without the table yet) is none.
async function coachPassages(supabase: SupabaseClient, groupId: string): Promise<ReadItem[]> {
  try {
    const { data: coaches, error } = await supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "coach");
    const ids = (coaches ?? []).map((c) => c.profile_id as string);
    if (error || ids.length === 0) return [];
    const { data, error: passagesError } = await supabase.from("coach_read_passages").select("reference, text").in("coach_id", ids).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(500);
    if (passagesError) return [];
    return (data ?? []).map((r) => ({ ref: (r.reference as string).trim(), text: (r.text as string).trim() }));
  } catch {
    return [];
  }
}

export async function getReadForViewer(
  supabase: SupabaseClient,
  groupId: string,
  viewerId: string,
  dateKey: string
): Promise<ReadForViewer | null> {
  try {
    const [{ data, error }, own] = await Promise.all([supabase.rpc("read_track_for_me", { p_group_id: groupId, p_date: dateKey }), coachPassages(supabase, groupId)]);
    if (error || !data) return null;
    const state = data as { enabled?: boolean; override_reference?: string | null; note_seen?: boolean };
    if (!state.enabled) return null;
    const item = pickDailyItem(withCoachPassages(FAITH_PACK, own), dateKey, viewerId, state.override_reference);
    if (!item) return null;
    return { ref: item.ref, text: item.text, noteSeen: state.note_seen === true };
  } catch {
    return null;
  }
}
