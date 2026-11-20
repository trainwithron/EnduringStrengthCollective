import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CoachMobileShell } from "@/components/coach/mobile/coach-mobile-shell";
import { RequestsCenter } from "@/components/coach/requests-center";
import { LoadFailed } from "@/components/ui/load-failed";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { supportEmail } from "@/lib/legal";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { parseFocus, REQUESTS_PATH } from "@/lib/requests-center";
import { loadRequestsCenter } from "@/lib/requests-center-server";

export const metadata = { title: "Requests" };

// One place for everything waiting on the coach's answer (Ron, Nov 19): sessions asked for, late cancels and moves to charge or waive, weekly-schedule changes, and people asking to train with
// the coach, then what was answered in the last 30 days. Every notice about one of them opens here at it (?notice=<id> or ?focus=<kind>:<id>). The open organization's requests, except the
// people asking to train with the coach, which are every organization's (a request goes to the organization the coach's public page belongs to).
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ focus?: string | string[]; notice?: string | string[] }> }) {
  const params = await searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActiveAnchor(supabase, user.id);
  if (active?.needsChoice) {
    const qs = new URLSearchParams();
    if (typeof params.focus === "string") qs.set("focus", params.focus);
    if (typeof params.notice === "string") qs.set("notice", params.notice);
    const next = qs.size > 0 ? `${REQUESTS_PATH}?${qs.toString()}` : REQUESTS_PATH;
    redirect(`${CHOOSE_ORGANIZATION_PATH}?next=${encodeURIComponent(next)}`);
  }
  const anchor = active?.anchor ?? null;
  if (!active || !anchor) return <NoAccess>Only coaches have requests to answer.</NoAccess>;

  const orgGroupIds = active.groups.filter((g) => g.orgId === active.orgId).map((g) => g.id);
  const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  const timezone = isValidTimeZone(profile?.timezone) ? (profile!.timezone as string) : DEFAULT_COACH_TIMEZONE;
  const notice = typeof params.notice === "string" ? params.notice : null;
  const data = await loadRequestsCenter(supabase, { userId: user.id, orgGroupIds, timezone, focus: parseFocus(params.focus), noticeId: notice });

  const body = (
    <>
      {data.failed && (
        <div className="mb-4">
          <LoadFailed />
        </div>
      )}
      <RequestsCenter
        groupIds={orgGroupIds}
        clients={data.clients}
        answered={data.answered}
        waitingCount={data.waitingCount}
        focus={data.focus}
        timezone={timezone}
        supportEmail={supportEmail()}
      />
    </>
  );

  if (await prefersAthleteStyleView()) {
    return (
      <CoachMobileShell groupId={anchor.id} groupName={anchor.name}>
        <div className="min-h-screen bg-graphite text-chalk font-body pb-24 px-4 pt-[72px]">
          <h1 className="font-display font-bold text-2xl uppercase leading-none mb-5">Requests</h1>
          {body}
        </div>
      </CoachMobileShell>
    );
  }
  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="clients" coachLevel>
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Requests</h1>
      </div>
      {body}
    </CoachDesktopShell>
  );
}
