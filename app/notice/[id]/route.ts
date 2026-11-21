import { NextResponse } from "next/server";
import { createCrossOrgServerClient } from "@/lib/supabase/server";
import { getActiveAnchor } from "@/lib/active-anchor";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { isUuid } from "@/lib/requests-center";
import { NOTICE_RESOLVE_PREFIX, isPrefetch, noticeHref } from "@/lib/notice-links";

const HOME_LINKS = new Set(["", "/", "/dashboard"]);

// Opens what a notice is about when the notice itself does not say (lib/notice-links.ts sends these here): the person's own notice is read, the item found, and the browser sent on.
// - request_decision (a client's answer to a session they asked for): the day of that session, not the whole month.
// - gym_visitor_lead (written with no group): the leads list of the organization the coach is working in.
// - support_reply with no group: that organization's Support page; payment_problem with no group (the coach's own plan): its Plan & Billing (Nov 21).
// Anything else, or nothing found, goes where the notice's own link goes; a notice that is not the person's opens their notifications.
// Opening it here marks it read (Nov 21: a tapped push used to leave its notice unread): every pushed notice opens through this route.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const supabase = await createCrossOrgServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return go(`/login?next=${encodeURIComponent(`${NOTICE_RESOLVE_PREFIX}${id}`)}`);
  if (!isUuid(id)) return go("/notifications");

  const { data: n } = await supabase.from("notifications").select("id, type, group_id, link_path, created_at").eq("id", id).eq("profile_id", user.id).maybeSingle();
  if (!n) return go("/notifications");
  const notice = n as { id: string; type: string; group_id: string | null; link_path: string | null; created_at: string };
  // read now that it was opened (best effort: the page opens either way); never by a prefetch of a link on screen, only by really opening it
  if (!isPrefetch(request)) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notice.id).eq("profile_id", user.id).is("read_at", null);
  const fallback = () => {
    const href = noticeHref(notice.type, notice.link_path, { groupId: notice.group_id });
    return go(href.startsWith(NOTICE_RESOLVE_PREFIX) ? notice.link_path || "/" : href);
  };

  try {
    if (notice.type === "request_decision" && notice.group_id) {
      const at = new Date(notice.created_at).getTime();
      const { data } = await supabase
        .from("booking_requests")
        .select("id, status, kind, from_start_at, new_start_at, decided_at")
        .eq("athlete_id", user.id)
        .eq("group_id", notice.group_id)
        .gte("decided_at", new Date(at - 5000).toISOString())
        .lte("decided_at", new Date(at + 5000).toISOString())
        .limit(5);
      const rows = (data ?? []) as { status: string; kind: string; from_start_at: string | null; new_start_at: string; decided_at: string }[];
      const r = rows.sort((a, b) => Math.abs(new Date(a.decided_at).getTime() - at) - Math.abs(new Date(b.decided_at).getTime() - at))[0];
      if (r) {
        const { data: me } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
        const tz = isValidTimeZone(me?.timezone) ? (me!.timezone as string) : DEFAULT_COACH_TIMEZONE;
        // a move that was not made: the session stayed where it was
        const day = r.kind === "move" && r.status !== "confirmed" && r.from_start_at ? r.from_start_at : r.new_start_at;
        return go(`/groups/${notice.group_id}/calendar/${dateKeyInZone(tz, new Date(day))}`);
      }
    }
    if (notice.type === "gym_visitor_lead") {
      const active = await getActiveAnchor(supabase, user.id);
      if (active?.anchor) return go(`/groups/${active.anchor.id}/business/leads`);
    }
    if ((notice.type === "support_reply" || notice.type === "payment_problem") && !notice.group_id && HOME_LINKS.has((notice.link_path ?? "").trim())) {
      const active = await getActiveAnchor(supabase, user.id);
      if (active?.anchor) return go(notice.type === "support_reply" ? `/groups/${active.anchor.id}/business/support` : `/groups/${active.anchor.id}/branding?tab=billing`);
    }
  } catch {
    // the notice's own link
  }
  return fallback();
}
