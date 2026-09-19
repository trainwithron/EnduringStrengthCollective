import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ExerciseHistoryUploader } from "@/components/coach/exercise-history-uploader";

// Locked design #2 (coach_onboarding_history_ingestion_scoping_sept19.md):
// the optional one-time client-facing entry point into the SAME uploader
// UI the coach's page uses — reuses ExerciseHistoryUploader verbatim,
// only reachable at all once a coach has explicitly turned on
// group_memberships.history_import_enabled for this client (surfaced as
// a Settings link, checked again here since a direct URL visit must not
// bypass that gate).
export default async function MyHistoryPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role, history_import_enabled")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "athlete" || !membership.history_import_enabled) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Ask your coach to enable this before you can enter your own exercise history.
        </p>
      </main>
    );
  }

  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", params.groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  const { data: libraryRows } = coachMembership
    ? await supabase.from("exercise_library").select("name").eq("created_by", coachMembership.profile_id)
    : { data: [] };
  const exerciseSuggestions = (libraryRows ?? []).map((r) => r.name as string).sort();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24 px-5 pt-8">
      <Link href={`/groups/${params.groupId}/settings`} className="font-body text-xs text-steel mb-4 inline-block">
        ← Back to Settings
      </Link>
      <h1 className="font-display font-bold text-2xl uppercase mb-1">Your exercise history</h1>
      <p className="font-body text-sm text-steel mb-6">
        Add anything from before you joined — a recent PR, a working max, or a spreadsheet of past sessions. This
        helps your coach&apos;s AI program builder start from where you actually are.
      </p>
      <ExerciseHistoryUploader
        athleteId={user.id}
        groupId={params.groupId}
        exerciseSuggestions={exerciseSuggestions}
        viewerIsCoach={false}
      />
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
