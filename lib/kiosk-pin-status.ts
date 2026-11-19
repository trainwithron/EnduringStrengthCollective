import type { SupabaseClient } from "@supabase/supabase-js";

// Which athletes in a group have a kiosk PIN, without ever reading a PIN (kiosk_pin_status, migration 0251). The old plain-column
// fallback is gone: that column no longer exists (PINs are hashed in kiosk_pins), so the fallback could only fail (Nov 19).
// null when it could not be read: a caller must never show that as "nobody has a PIN".
export async function loadKioskPinStatus(supabase: SupabaseClient, groupId: string): Promise<Map<string, boolean> | null> {
  const out = new Map<string, boolean>();
  const { data, error } = await supabase.rpc("kiosk_pin_status", { p_group_id: groupId });
  if (error) return null;
  for (const r of (data ?? []) as { athlete_id: string; has_pin: boolean }[]) out.set(r.athlete_id, !!r.has_pin);
  return out;
}
