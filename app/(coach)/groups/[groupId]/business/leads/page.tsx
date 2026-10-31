import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { redirect } from "next/navigation";
import { redirectOneOnOneToAnchor } from "@/lib/coach-wide-redirect";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import Link from "next/link";

export const metadata = { title: "Leads" };

// equipment_qr_decal_scoping_sept19.md — where a gym_visitor_lead
// (a walk-in scanning an equipment QR code and expressing interest)
// actually surfaces for the coach, beyond just the one-time push
// notification. Org-wide data on a per-groupId route, same convention
// already used by Business/Waiver/Support on this shell.
// 50 a page, newest first (layout audit, Oct 31: every lead ever used to load in one long column).
const PAGE_SIZE = 50;

export default async function LeadsPage(props: { params: Promise<{ groupId: string }>; searchParams: Promise<{ page?: string }> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const page = Math.max(1, Math.floor(Number(searchParams.page) || 1));
  await redirectOneOnOneToAnchor(params.groupId, "business/leads");
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can view leads.</NoAccess>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name, organization_id")
    .eq("id", params.groupId)
    .single();

  const { data: leads, count } = group?.organization_id
    ? await supabase
        .from("gym_visitor_leads")
        .select("id, full_name, contact_info, note, created_at, exercise_library ( name )", { count: "exact" })
        .eq("organization_id", group.organization_id)
        .order("created_at", { ascending: false })
        .order("id")
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    : { data: null, count: 0 };
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const pageHref = (n: number) => `/groups/${params.groupId}/business/leads${n > 1 ? `?page=${n}` : ""}`;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="leads">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Leads</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Everyone who scanned an equipment QR code and said they&apos;re interested in joining.
        </p>
      </div>

      {!leads || leads.length === 0 ? (
        <p className="font-body text-sm text-steel">No leads yet.</p>
      ) : (
        <>
        {/* A table when the page is wide enough; stacked rows on a narrow one. */}
        <div className="divide-y divide-steel/15 border-y border-steel/15">
          <div className="hidden @3xl:grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_5rem] gap-4 py-2 font-body text-xs text-steel uppercase tracking-wide">
            <span>Name</span>
            <span>Contact</span>
            <span>Scanned</span>
            <span>Note</span>
            <span className="text-right">Date</span>
          </div>
          {leads.map((lead: any) => (
            <div key={lead.id} className="py-3 grid grid-cols-1 gap-0.5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_5rem] @3xl:gap-4 @3xl:items-baseline">
              <p className="font-body font-medium text-[15px] break-words">{lead.full_name}</p>
              <p className="font-body text-sm text-rust break-words">{lead.contact_info}</p>
              <p className="font-body text-xs text-steel">{lead.exercise_library?.name ? <><span className="@3xl:hidden">Scanned: </span>{lead.exercise_library.name}</> : <span className="hidden @3xl:inline">—</span>}</p>
              <p className="font-body text-sm text-chalk break-words">{lead.note ?? ""}</p>
              <p className="font-body text-xs text-steel @3xl:text-right">
                {new Date(lead.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
          ))}
        </div>
        {pages > 1 && (
          <nav className="flex items-center gap-4 mt-4 font-body text-sm" aria-label="Pages">
            {page > 1 && <Link href={pageHref(page - 1)} className="text-rust">&larr; Newer</Link>}
            <span className="text-steel">Page {page} of {pages}</span>
            {page < pages && <Link href={pageHref(page + 1)} className="text-rust">Older &rarr;</Link>}
          </nav>
        )}
        </>
      )}
    </CoachDesktopShell>
  );
}
