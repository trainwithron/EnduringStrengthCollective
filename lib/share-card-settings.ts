import type { SupabaseClient } from "@supabase/supabase-js";
import { readInstagramHandle } from "@/lib/instagram-handle";

// The coach's share-picture settings (components/coach/share-card-settings.tsx), read for the Booking page and Availability screens: the QR switch from the coach's public page row and the
// Instagram handle from the coach's own settings (one place, the same value Settings shows). null when either cannot be read (no public page yet, or before the database updates): then the
// block is not shown (the handle is still in Settings).
export async function readShareCardSettings(supabase: SupabaseClient, coachId: string): Promise<{ handle: string | null; qr: boolean } | null> {
  const [page, handle] = await Promise.all([supabase.from("coach_booking_pages").select("share_card_qr").eq("coach_id", coachId).maybeSingle(), readInstagramHandle(supabase, coachId)]);
  if (page.error || !page.data || !handle) return null;
  return { handle: handle.handle, qr: (page.data as { share_card_qr: boolean | null }).share_card_qr !== false };
}
