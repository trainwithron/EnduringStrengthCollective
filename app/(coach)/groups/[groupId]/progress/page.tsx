import { redirect } from "next/navigation";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { NoAccess } from "@/components/shared/no-access";
import { isReadFailure } from "@/lib/read-failed";
import { createServerClient } from "@/lib/supabase/server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { getGroupCoachTimezone } from "@/lib/timezone";
import { loadLiftUnit } from "@/lib/lift-unit-server";
import { loadMyProgress } from "@/lib/my-progress";
import { recapYearFor } from "@/lib/year-recap";
import { greetingFirstName } from "@/lib/first-name";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { MyProgressView } from "@/components/athlete/progress/my-progress-view";
import { InbodyEntry } from "@/components/body/inbody-entry";

export const metadata = { title: "My progress" };

// My progress (wave 2, P1 + P2; Ron approved the mockup Nov 20): the client's own read-only view of their lifts (the coach's Progress cards: an estimated-max line
// per lift and the best at each rep count), their body weight, and the way to their photos, measurements and (in December) their year's recap. Read-only.
// A coach looking as the client sees what the client sees.
export default async function MyProgressPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { athleteId } = await getEffectiveAthlete(params.groupId, user.id);
  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", athleteId)
    .maybeSingle();
  if (isReadFailure(membershipError)) return <LoadFailedPage />;
  if (!membership) return <NoAccess>This group isn&apos;t available, or you don&apos;t have access to it.</NoAccess>;

  const timeZone = await getGroupCoachTimezone(supabase, params.groupId);
  const [progress, unit, { data: profile }] = await Promise.all([
    loadMyProgress(supabase, { athleteId, groupId: params.groupId, timeZone }),
    loadLiftUnit(supabase, athleteId),
    supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle(),
  ]);
  const recapYear = recapYearFor(progress.todayKey);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <MyProgressView
        groupId={params.groupId}
        firstName={greetingFirstName((profile as { full_name?: string | null } | null)?.full_name ?? null)}
        cards={progress.cards.slice(0, Math.max(progress.visible, 8))}
        bodyWeight={progress.bodyWeight}
        todayKey={progress.todayKey}
        unit={unit}
        incomplete={progress.incomplete}
        recapYear={recapYear}
      />
      {/* The InBody scans and their graphs live here now (CL1, Nov 21: Home keeps only the InBody tile, which adds one). */}
      <section className="px-5 pt-4" data-progress-inbody>
        <div className="bg-surface rounded-card px-4 py-1">
          <InbodyEntry athleteId={athleteId} groupId={params.groupId} />
        </div>
      </section>
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
