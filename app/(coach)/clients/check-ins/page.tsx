import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CoachMobileShell } from "@/components/coach/mobile/coach-mobile-shell";
import { LoadFailed } from "@/components/ui/load-failed";
import { CheckinReviewList } from "@/components/coach/checkin-review-list";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { COACH_CHECKINS_PATH } from "@/lib/weekly-checkin";
import { loadCoachCheckins } from "@/lib/weekly-checkin-coach";
import { signedPhotoUrls } from "@/lib/weekly-checkin-server";

export const metadata = { title: "Check-ins" };

// The coach's weekly check-ins (Ron, Nov 20: R2): every check-in waiting to be reviewed in the open organization, newest first, and who has not sent this week's. Reached from the Clients
// page, Home's Needs you, and the notice a check-in sends. Phone and computer alike.
// ?focus=<check-in id> (Needs you's Review, Nov 21): that client's check-in opens first and is shown, as Requests does with its rows.
export default async function CheckinsPage(props: { searchParams?: Promise<{ focus?: string }> }) {
  const focus = (await props.searchParams)?.focus ?? null;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActiveAnchor(supabase, user.id);
  if (active?.needsChoice) redirect(`${CHOOSE_ORGANIZATION_PATH}?next=${encodeURIComponent(COACH_CHECKINS_PATH)}`);
  const anchor = active?.anchor ?? null;
  if (!active || !anchor) return <NoAccess>Only coaches have check-ins to review.</NoAccess>;

  const groupIds = active.groups.filter((g) => g.orgId === active.orgId).map((g) => g.id);
  const { data: me } = await supabase.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle();
  const timeZone = isValidTimeZone(me?.timezone) ? (me!.timezone as string) : DEFAULT_COACH_TIMEZONE;
  const data = await loadCoachCheckins(supabase, { coachId: user.id, anchorGroupId: anchor.id, groupIds, timeZone });
  const photoEntries = await Promise.all(data.toReview.filter((i) => i.photoIds.length > 0).map(async (i) => [i.id, await signedPhotoUrls(supabase, i.photoIds, i.athleteId)] as const));

  const body = !data.available ? (
    <p className="font-body text-sm text-steel">No weekly check-ins have come in yet.</p>
  ) : (
    <>
      {data.failed && (
        <div className="mb-4">
          <LoadFailed />
        </div>
      )}
      <CheckinReviewList
        items={data.toReview}
        photos={Object.fromEntries(photoEntries)}
        coach={{ id: user.id, name: ((me?.full_name as string | null) ?? "").trim() || "Your coach" }}
        timeZone={timeZone}
        nowIso={new Date().toISOString()}
        weekStart={data.weekStart}
        notSentCount={data.notSent.length}
        focusId={focus}
      />
    </>
  );

  if (await prefersAthleteStyleView()) {
    return (
      <CoachMobileShell groupId={anchor.id} groupName={anchor.name}>
        <div className="min-h-screen bg-graphite text-chalk font-body pb-24 px-4 pt-[72px]">{body}</div>
      </CoachMobileShell>
    );
  }
  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="clients" coachLevel>
      <div className="max-w-2xl">
        <Link href="/clients" className="inline-flex items-center min-h-11 mb-2 font-body text-sm text-steel">
          &larr; Clients
        </Link>
        {body}
      </div>
    </CoachDesktopShell>
  );
}
