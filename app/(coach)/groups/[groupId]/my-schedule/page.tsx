import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { NoAccess } from "@/components/shared/no-access";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { MySchedule } from "@/components/athlete/my-schedule";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { loadMySchedule } from "@/lib/my-schedule-data";

// "My schedule": a client's weekly schedule and three plain buttons to ask for a pause, a freeze or to cancel (migration 0297). Only the client sees it; a coach looking
// in as the client sees the schedule but cannot send requests for them.
export default async function MySchedulePage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const athleteId = effective.athleteId;
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", athleteId).maybeSingle();
  if (membership?.role !== "athlete") {
    return <NoAccess>My schedule is for clients. Coaches change a client&apos;s schedule from the client&apos;s profile.</NoAccess>;
  }

  const data = await loadMySchedule(supabase, params.groupId, athleteId);
  let actingAsName: string | null = null;
  if (effective.isActingAsOther) {
    const { data: nameRow } = await supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
    actingAsName = (nameRow?.full_name as string | null) ?? null;
  }
  const canRequest = data.requestsAvailable && !effective.isActingAsOther;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28 px-5 pt-8">
      {effective.isActingAsOther && <ActingAsBanner athleteFullName={actingAsName ?? "Client"} groupId={params.groupId} />}
      <Link href={`/groups/${params.groupId}`} className="font-body text-xs text-steel mb-4 inline-block">
        ← Back to Home
      </Link>
      <h1 className="font-display font-bold text-2xl uppercase mb-1">My schedule</h1>
      {data.items.length === 0 ? (
        <p className="font-body text-sm text-steel mt-3">You don&apos;t have a weekly schedule yet. Your coach sets one up with you.</p>
      ) : (
        <>
          <p className="font-body text-sm text-steel mb-5">Your weekly sessions. Need a break? Ask here and your coach will reach out.</p>
          <MySchedule groupId={params.groupId} items={data.items} canRequest={canRequest} />
        </>
      )}
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
