import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { readRowsByIds } from "@/lib/read-by-ids";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import { LateChangesPanel } from "@/components/coach/late-changes-panel";
import { ScheduleRequestsPanel } from "@/components/coach/schedule-requests-panel";
import { ExpiryCheckInPanel } from "@/components/coach/expiry-checkin-panel";
import { InactiveClientsPanel } from "@/components/coach/inactive-clients-panel";
import { ProgressLookPanel } from "@/components/coach/progress-look-panel";
import { CoachMobileShell } from "./coach-mobile-shell";
import { SessionCheckSection } from "@/components/coach/session-check-section";
import { NextClientWorkoutSection } from "@/components/coach/next-client-workout-section";
import { groupsInOrgOfOpened } from "@/lib/coach-groups";
import { isTeamSportGroup } from "@/lib/team-sport";
import { TeamCoachPhoneHome } from "./team-coach-phone-home";
import { homeTitle } from "@/lib/phone-home-title";

// The coach's phone Home, kept to what a coach in the gym needs (Ron, Oct 19: "look how repetitive this is"): the title, the "Did X's session happen?" cards when there are any, ONE big button for the next client's
// workout (or "Resume ..." for one left open), and the few things that need a decision (late changes, requests) only when they exist. Nothing repeats what the bottom bar already does (Home, Clients, Messages, Calendar,
// More): no clients card, no quick-actions block, no business tiles (those are under More > Business), no Desktop Mode button (under More), and no start button for the coach's OWN workout: that is the "Coach (you)" row
// at the top of the Clients list.
export async function CoachMobileHome({
  groupId,
  groupName,
  coachId,
}: {
  groupId: string;
  groupName: string;
  coachId: string;
}) {
  const supabase = await createServerClient();
  // A team-sport group gets its own short phone home (the active program, the team, one More tools): no money, no first-client nag, no Needs attention strip.
  const { data: teamRow } = await supabase.from("groups").select("team_mode").eq("id", groupId).maybeSingle();
  if (isTeamSportGroup((teamRow as { team_mode?: boolean | null } | null)?.team_mode)) return <TeamCoachPhoneHome groupId={groupId} groupName={groupName} />;
  // The panels below read for the whole coach; on a phone Home they stay inside this group's organization (another one appears only after switching to it).
  const orgGroups = await groupsInOrgOfOpened(supabase, coachId, groupId);
  const orgGroupIds = orgGroups.map((g) => g.id);
  // The title is the ORGANIZATION the coach is working in (Ron, Oct 19); the group this page is for sits under it when it has a name of its own. A client's own space keeps the client's name.
  const pageGroup = orgGroups.find((g) => g.id === groupId);
  const title = homeTitle(pageGroup, groupName);

  // Does the coach have any client at all (in this group or any other group of the organization, not set aside)? With none, Home offers one plain "Add a client" button.
  const { data: rosterRows } = await supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "athlete").limit(1);
  let hasClients = (rosterRows ?? []).length > 0;
  if (!hasClients) {
    const others = orgGroupIds.filter((id) => id !== groupId);
    if (others.length > 0) {
      const [{ data: elsewhere }, asideKeys] = await Promise.all([
        readRowsByIds(others, (g) => (from, to) => supabase.from("group_memberships").select("profile_id, group_id").eq("role", "athlete").in("group_id", g).order("id").range(from, to)),
        fetchInactiveKeys(supabase, others),
      ]);
      hasClients = ((elsewhere ?? []) as { profile_id: string; group_id: string }[]).some((m) => !asideKeys.has(inactiveKey(m.group_id, m.profile_id)));
    }
  }

  return (
    // pb-24: the fixed bottom tabs are 64px tall; without room under the last row it sits behind them and cannot be scrolled into view.
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <CoachMobileShell groupId={groupId} groupName={groupName}>
        {/* The Spotlight button is fixed at the top centre (top-3, h-10, so it ends about 100px down) on every mobile page, and a long organization name reaches it: the title starts below it. */}
        <header className="px-5 pt-[108px] pb-4">
          <h1 className="font-display font-bold text-3xl leading-none uppercase truncate">{title.main}</h1>
          {title.sub && <p className="font-body text-sm text-steel mt-1 truncate">{title.sub}</p>}
        </header>

        <div className="px-5">
          <SessionCheckSection coachId={coachId} groupIds={orgGroupIds} />
          {hasClients ? (
            <NextClientWorkoutSection coachId={coachId} groupIds={orgGroupIds} emptyLine />
          ) : (
            <Link href={`/groups/${groupId}/clients?add=1`} className="mb-6 h-14 flex items-center justify-center bg-rust text-graphite font-display uppercase text-lg font-bold">
              Add a client
            </Link>
          )}
          {/* The same anchors as the computer Home: a booking-request or late-change notice opens /dashboard#late-changes, which on a phone is this page. */}
          <div id="late-changes" className="scroll-mt-24">
            <LateChangesPanel groupIds={orgGroupIds} />
          </div>
          <div id="schedule-requests" className="scroll-mt-24">
            <ScheduleRequestsPanel groupIds={orgGroupIds} />
          </div>
          <ExpiryCheckInPanel groupIds={orgGroupIds} />
          <InactiveClientsPanel groupIds={orgGroupIds} />
          <ProgressLookPanel groupIds={orgGroupIds} />
        </div>
      </CoachMobileShell>
    </main>
  );
}
