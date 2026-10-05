import type { SupabaseClient } from "@supabase/supabase-js";

// Which athletes in a group have a kiosk PIN, without ever reading a PIN. Uses kiosk_pin_status (migration 0251);
// until that exists it falls back to the old column, so the screen keeps working during a staged rollout.
export async function loadKioskPinStatus(supabase: SupabaseClient, groupId: string): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const { data, error } = await supabase.rpc("kiosk_pin_status", { p_group_id: groupId });
  if (!error) {
    for (const r of (data ?? []) as { athlete_id: string; has_pin: boolean }[]) out.set(r.athlete_id, !!r.has_pin);
    return out;
  }
  const { data: legacy } = await supabase
    .from("group_memberships")
    .select("profile_id, kiosk_pin")
    .eq("group_id", groupId)
    .eq("role", "athlete");
  for (const r of (legacy ?? []) as { profile_id: string; kiosk_pin: string | null }[]) out.set(r.profile_id, !!r.kiosk_pin);
  return out;
}
