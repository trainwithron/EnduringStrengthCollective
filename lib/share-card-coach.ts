import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { configuredAppUrl } from "@/lib/app-url";
import { coachFirstNameOf } from "@/lib/share-image";

// The coach's corner of a share picture (lib/share-image.ts coachStrip): the coach of the group the workout was logged in (a coach's own workout in their own space: themselves), a QR code to
// their public page /c/<slug> while that page is really showing (switched on and published) and they keep "Put a QR code ... on my clients' share cards" on, and their Instagram handle
// when they set one (in their own settings; a coach with no public page has the handle too). Read with the service role because the share page is public; only the coach's own public details leave here (first name, public page address, handle).
export const CANONICAL_APP_URL = "https://spotlightcoaching.app";

export type CoachStrip = { qrUrl: string | null; coachFirstName: string; handle: string | null };

export async function loadShareCardCoach(groupId: string, db: SupabaseClient = createServiceRoleClient()): Promise<CoachStrip | null> {
  try {
    const { data: coach } = await db
      .from("group_memberships")
      .select("profile_id, profiles ( full_name )")
      .eq("group_id", groupId)
      .eq("role", "coach")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!coach) return null;
    const coachId = (coach as { profile_id: string }).profile_id;
    const profile = (coach as { profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null }).profiles;
    const fullName = (Array.isArray(profile) ? profile[0] : profile)?.full_name ?? "";
    const [pageRead, siteRead, handleRead] = await Promise.all([
      // A coach with no public page has no row here: no code, the handle may still show.
      db.from("coach_booking_pages").select("slug, enabled, share_card_qr").eq("coach_id", coachId).maybeSingle(),
      db.from("coach_sites").select("published").eq("coach_id", coachId).maybeSingle(),
      // The handle lives in the coach's own settings (0438), for every coach. Before that update this read errors and no handle is shown.
      db.from("coach_profiles").select("instagram_handle").eq("coach_id", coachId).maybeSingle(),
    ]);
    const page = pageRead.error ? null : (pageRead.data as { slug: string; enabled: boolean | null; share_card_qr: boolean | null } | null);
    const pageShows = !!page && page.enabled === true && (siteRead.data as { published?: boolean | null } | null)?.published === true;
    const qrUrl = page && pageShows && page.share_card_qr !== false ? `${configuredAppUrl() ?? CANONICAL_APP_URL}/c/${page.slug}` : null;
    const handle = handleRead.error ? null : ((handleRead.data as { instagram_handle?: string | null } | null)?.instagram_handle?.trim() || null);
    if (!qrUrl && !handle) return null;
    return { qrUrl, coachFirstName: coachFirstNameOf(fullName), handle };
  } catch {
    return null;
  }
}
