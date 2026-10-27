import type { SupabaseClient } from "@supabase/supabase-js";
import { configuredAppUrl } from "@/lib/app-url";
import { CANONICAL_APP_URL } from "@/lib/share-card-coach";

// "My page QR code" in a coach's own Settings (Ron, Oct 27: gym posters where scanning "take[s] them to the trainer page"): a QR code to the coach's public page /c/<slug>, only while
// that page is really showing (switched on and published, the same rule the page itself and the share-picture code use). Otherwise the coach is pointed to where it is switched
// on: Calendar > Availability (the one switch; a coach with no page yet gets theirs there, as always), or the website settings when the page is on but not published. Reading this
// never makes, switches on or publishes anything.
export const AVAILABILITY_HREF = "/calendar?tab=availability";
export const TURN_ON_PAGE_TEXT = "Turn on your public page to get a QR code";

export type MyPageQr = { kind: "ready"; url: string } | { kind: "off"; href: string };

export async function readMyPageQr(supabase: SupabaseClient, coachId: string, groupId: string): Promise<MyPageQr | null> {
  try {
    const [pageRead, siteRead] = await Promise.all([
      supabase.from("coach_booking_pages").select("slug, enabled").eq("coach_id", coachId).maybeSingle(),
      supabase.from("coach_sites").select("published").eq("coach_id", coachId).maybeSingle(),
    ]);
    // A failed read (or a database without these tables) shows nothing rather than a wrong "turn it on".
    if (pageRead.error || siteRead.error) return null;
    const page = pageRead.data as { slug: string; enabled: boolean | null } | null;
    if (!page || page.enabled !== true) return { kind: "off", href: AVAILABILITY_HREF };
    if ((siteRead.data as { published?: boolean | null } | null)?.published !== true) return { kind: "off", href: `/groups/${groupId}/business/website` };
    return { kind: "ready", url: `${configuredAppUrl() ?? CANONICAL_APP_URL}/c/${page.slug}` };
  } catch {
    return null;
  }
}
