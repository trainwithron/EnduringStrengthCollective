import type { SupabaseClient } from "@supabase/supabase-js";
import { FAITH_PACK, pickDailyItem } from "@/lib/read-content";

// What the rest timer needs to show "Read": the passage for this person today, and whether they have seen the one-time note. Null means Read is not offered at all
// (turned off by the client, turned off by a coach for all their clients, or the lookup failed: Read never blocks a workout).
export interface ReadForViewer {
  ref: string;
  text: string;
  noteSeen: boolean;
}

export async function getReadForViewer(
  supabase: SupabaseClient,
  groupId: string,
  viewerId: string,
  dateKey: string
): Promise<ReadForViewer | null> {
  try {
    const { data, error } = await supabase.rpc("read_track_for_me", { p_group_id: groupId, p_date: dateKey });
    if (error || !data) return null;
    const state = data as { enabled?: boolean; override_reference?: string | null; note_seen?: boolean };
    if (!state.enabled) return null;
    const item = pickDailyItem(FAITH_PACK, dateKey, viewerId, state.override_reference);
    if (!item) return null;
    return { ref: item.ref, text: item.text, noteSeen: state.note_seen === true };
  } catch {
    return null;
  }
}
