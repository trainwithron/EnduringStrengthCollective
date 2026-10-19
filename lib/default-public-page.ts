import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSlug, slugProblem } from "@/lib/public-booking";

// Every coach HAS a public page: nobody is asked to create one, pick an address or set anything up first (Ron, Oct 19: "I just need a calendar that people can book on and I can schedule on"). The first time the coach opens
// Calendar > Availability, three things are made for them, once: the page itself (an address made from their name, on, with "ask to train with me" on), one public session type called Consultation (free, 30 minutes, anywhere),
// and the short public page at /c/<address> (published). All of it can be switched off with the one switch in Availability; nothing here is ever recreated once the coach has a page.
export interface PublicPageState {
  slug: string;
  enabled: boolean;
  acceptsRequests: boolean;
}

export const DEFAULT_CONSULTATION = {
  name: "Consultation",
  credit_cost: 0,
  duration_minutes: 30,
  location_kind: "either",
  description: "A short first conversation about what you want to work on.",
  public_visible: true,
} as const;

const TRIES = 6;

/** The address made from a name, or a plain fallback when the name gives nothing usable. */
export function defaultSlug(fullName: string | null | undefined, attempt: number, random: () => string = () => Math.random().toString(36).slice(2, 6)): string {
  const base = normalizeSlug(fullName ?? "");
  const good = base && !slugProblem(base) ? base : "coach";
  if (attempt === 0 && good !== "coach") return good;
  const suffix = random().replace(/[^a-z0-9]/g, "").slice(0, 4) || "x1";
  const trimmed = good.slice(0, 40 - suffix.length - 1).replace(/-+$/g, "");
  const candidate = `${trimmed}-${suffix}`;
  return slugProblem(candidate) ? `coach-${suffix}${attempt}`.slice(0, 40) : candidate;
}

export async function ensureDefaultPublicPage(supabase: SupabaseClient, coachId: string, fullName: string | null | undefined): Promise<PublicPageState | null> {
  try {
    const existing = await supabase.from("coach_booking_pages").select("slug, enabled, accepts_requests").eq("coach_id", coachId).maybeSingle();
    if (existing.error) return null;
    if (existing.data) {
      const row = existing.data as { slug: string; enabled: boolean | null; accepts_requests?: boolean | null };
      return { slug: row.slug, enabled: row.enabled === true, acceptsRequests: row.accepts_requests !== false };
    }
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const slug = defaultSlug(fullName, attempt);
      const made = await supabase.from("coach_booking_pages").insert({ coach_id: coachId, slug, enabled: true }).select("slug, enabled, accepts_requests").single();
      if (!made.error && made.data) {
        await makeTheRest(supabase, coachId);
        const row = made.data as { slug: string; enabled: boolean | null; accepts_requests?: boolean | null };
        return { slug: row.slug, enabled: row.enabled === true, acceptsRequests: row.accepts_requests !== false };
      }
      // taken by another coach: try the next one; made at the same moment by this coach (a second open): read it
      const again = await supabase.from("coach_booking_pages").select("slug, enabled, accepts_requests").eq("coach_id", coachId).maybeSingle();
      if (again.data) {
        const row = again.data as { slug: string; enabled: boolean | null; accepts_requests?: boolean | null };
        return { slug: row.slug, enabled: row.enabled === true, acceptsRequests: row.accepts_requests !== false };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// The public session type and the short public page. Each is best effort and made only if the coach has none, so a coach who already built their own is never touched.
async function makeTheRest(supabase: SupabaseClient, coachId: string): Promise<void> {
  try {
    const { data: publicTypes } = await supabase.from("session_types").select("id").eq("coach_id", coachId).eq("public_visible", true).limit(1);
    if (!publicTypes || publicTypes.length === 0) await supabase.from("session_types").insert({ coach_id: coachId, ...DEFAULT_CONSULTATION });
  } catch {
    // The page still exists; the coach can add a session type in the Booking page screen.
  }
  try {
    await supabase.from("coach_sites").upsert({ coach_id: coachId, published: true }, { onConflict: "coach_id", ignoreDuplicates: true });
  } catch {
    // Same: the short public page is optional.
  }
}
