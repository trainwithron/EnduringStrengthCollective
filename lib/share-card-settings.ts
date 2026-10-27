import type { SupabaseClient } from "@supabase/supabase-js";

// The coach's share-picture settings (components/coach/share-card-settings.tsx), read for the settings screens: the two settings, or null when they cannot be read (before the database
// update adds them, or no public page yet). Then the block is not shown.
export async function readShareCardSettings(supabase: SupabaseClient, coachId: string): Promise<{ handle: string | null; qr: boolean } | null> {
  const { data, error } = await supabase.from("coach_booking_pages").select("instagram_handle, share_card_qr").eq("coach_id", coachId).maybeSingle();
  if (error || !data) return null;
  const row = data as { instagram_handle: string | null; share_card_qr: boolean | null };
  return { handle: row.instagram_handle, qr: row.share_card_qr !== false };
}
