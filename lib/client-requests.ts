import { cleanParam } from "@/lib/public-booking-route";
import { isRealCoach } from "@/lib/real-coach";

// "Request to train with me" on a coach's public page (/c/<slug>). The button shows ONLY when the coach's page is on, the coach has left the request switch on (Booking page settings), and the coach belongs to an
// organization the request can go to. The database function submit_client_request checks all of the same again, so a hand-made call is refused too.
export function canRequestOnPage(page: { enabled: boolean | null | undefined; acceptsRequests: boolean | null | undefined; organizationId: string | null | undefined }): boolean {
  return page.enabled === true && page.acceptsRequests === true && !!page.organizationId;
}

/** A YYYY-MM-DD string that is a real calendar day (2020-02-30 and 2020-13-45 are not). */
export function isRealCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export interface RequestTarget {
  coachId: string;
  slug: string;
  coachName: string;
}

/**
 * Reads the public page for a slug and says whether it is taking requests (the server's own database client). Never throws: any read that fails means "not taking requests", so a button is never shown that could not work.
 * accepts_requests is read on its own so a database that does not have the column yet shows no button instead of breaking the page.
 */
export async function requestTargetFor(db: any, slugParam: string | undefined): Promise<RequestTarget | null> {
  try {
    const slug = cleanParam((slugParam ?? "").toLowerCase(), 40);
    if (!slug) return null;
    const { data: page, error } = await db.from("coach_booking_pages").select("coach_id, slug, enabled").eq("slug", slug).maybeSingle();
    if (error || !page || page.enabled !== true) return null;
    const [{ data: switchRow, error: switchError }, { data: org }, real, { data: profile }] = await Promise.all([
      db.from("coach_booking_pages").select("accepts_requests").eq("coach_id", page.coach_id).maybeSingle(),
      db.rpc("client_request_org", { p_coach: page.coach_id }),
      isRealCoach(db, page.coach_id),
      db.from("profiles").select("full_name").eq("id", page.coach_id).maybeSingle(),
    ]);
    if (switchError || !real) return null;
    if (!canRequestOnPage({ enabled: true, acceptsRequests: (switchRow as { accepts_requests?: boolean } | null)?.accepts_requests === true, organizationId: typeof org === "string" ? org : null })) return null;
    return { coachId: page.coach_id as string, slug: page.slug as string, coachName: ((profile as { full_name?: string | null } | null)?.full_name ?? "").trim() || "your coach" };
  } catch {
    return null;
  }
}
