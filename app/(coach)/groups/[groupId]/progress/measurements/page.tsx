import Link from "next/link";
import { redirect } from "next/navigation";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { NoAccess } from "@/components/shared/no-access";
import { isReadFailure } from "@/lib/read-failed";
import { createServerClient } from "@/lib/supabase/server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { loadLiftUnit } from "@/lib/lift-unit-server";
import { readMeasurements, tapeUnitFor } from "@/lib/body-measurements";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-bar";
import { MeasurementsView } from "@/components/athlete/progress/measurements-view";

export const metadata = { title: "Measurements" };

// Tape measurements (wave 2, P6; Ron approved the mockup Nov 20): the client's waist, hips, chest, arm and thigh over time, and a form to add a day's numbers.
// The client's own; a coach standing in as the client (View as client) sees and enters them for that client, the same rule the table holds (step 213: the person
// or their coach). In the person's unit: inches, or centimetres for someone who uses kilograms. Before step 213 is applied there are simply no measurements yet.
export default async function MeasurementsPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
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
  if (!membership) return <NoAccess>This page is for the people in this group.</NoAccess>;

  const effective = await getEffectiveAthlete(params.groupId, user.id);
  // A client sees their own; a coach only while standing in as a client (or in their own training space).
  if (membership.role !== "athlete" && !effective.isActingAsOther) {
    return <NoAccess>Measurements are kept by each client. Open them as the client to see or add theirs.</NoAccess>;
  }
  const athleteId = membership.role === "athlete" ? user.id : effective.athleteId;

  const [rows, weightUnit, actingAsName] = await Promise.all([
    readMeasurements(supabase, athleteId, params.groupId),
    loadLiftUnit(supabase, athleteId),
    effective.isActingAsOther && athleteId !== user.id
      ? supabase
          .from("profiles")
          .select("full_name")
          .eq("id", athleteId)
          .maybeSingle()
          .then((r) => ((r.data as { full_name?: string | null } | null)?.full_name ?? "Client"))
      : Promise.resolve(null),
  ]);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-6">
      {actingAsName && <ActingAsBanner athleteFullName={actingAsName} groupId={params.groupId} />}
      <header className="h-14 px-3 flex items-center gap-2">
        <Link
          href={`/groups/${params.groupId}/progress`}
          aria-label="Back to My progress"
          className="w-11 h-11 shrink-0 rounded-full bg-surface text-chalk inline-flex items-center justify-center"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1 className="font-display font-semibold text-[22px] leading-tight text-chalk">Measurements</h1>
      </header>
      <div className="px-[18px] pt-1.5">
        <MeasurementsView rows={rows} unit={tapeUnitFor(weightUnit)} athleteId={athleteId} groupId={params.groupId} />
      </div>
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
