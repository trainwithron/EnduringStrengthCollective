import { LoadFailedPage } from "@/components/ui/load-failed-page";
import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { isMemberOfGroup, NOT_IN_GROUP_MESSAGE } from "@/lib/athlete-in-group";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ExerciseHistoryUploader } from "@/components/coach/exercise-history-uploader";
import { HistoryImportAccessToggle } from "@/components/coach/history-import-access-toggle";
import { HistoryImportPicker } from "@/components/coach/history-import-picker";
import { UnclearPointsReview } from "@/components/coach/unclear-points-review";
import { IMPORT_BASELINE_NOTE, IMPORT_UNITS_NOTE, listUnclearPoints } from "@/lib/unclear-points";

export default async function ClientHistoryPage(
  props: {
    params: Promise<{ groupId: string; athleteId: string }>;
  }
) {
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

  if (membershipError) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can upload a client&apos;s exercise history.</NoAccess>
    );
  }

  if (!(await isMemberOfGroup(supabase, params.groupId, params.athleteId))) {
    return <NoAccess>{NOT_IN_GROUP_MESSAGE}</NoAccess>;
  }

  const [{ data: group }, { data: athleteProfile }, { data: athleteMembership }, { data: libraryRows }, unclearPoints] =
    await Promise.all([
      supabase.from("groups").select("name").eq("id", params.groupId).maybeSingle(),
      supabase.from("profiles").select("full_name").eq("id", params.athleteId).maybeSingle(),
      supabase
        .from("group_memberships")
        .select("history_import_enabled")
        .eq("group_id", params.groupId)
        .eq("profile_id", params.athleteId)
        .maybeSingle(),
      supabase.from("exercise_library").select("name").eq("created_by", user.id),
      listUnclearPoints(supabase, params.groupId, params.athleteId),
    ]);

  const athleteName = athleteProfile?.full_name ?? "Client";
  const exerciseSuggestions = (libraryRows ?? []).map((r) => r.name as string).sort();

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <div className="p-8">
        <Link
          href={`/groups/${params.groupId}/athletes/${params.athleteId}`}
          className="font-body text-xs text-steel mb-4 inline-block"
        >
          ← Back to {athleteName}
        </Link>
        <h1 className="font-display font-bold text-2xl uppercase mb-1">Import client history</h1>

        <HistoryImportPicker athleteId={params.athleteId} groupId={params.groupId} athleteName={athleteName} />

        <div className="mt-8">
          <ExerciseHistoryUploader
            athleteId={params.athleteId}
            groupId={params.groupId}
            exerciseSuggestions={exerciseSuggestions}
            viewerIsCoach
            parts={{ quick: true, spreadsheet: false, entries: true }}
          />
        </div>

        <UnclearPointsReview athleteId={params.athleteId} groupId={params.groupId} initial={unclearPoints} />

        <details className="mt-8 max-w-2xl border border-steel/20 p-4">
          <summary className="font-body text-sm text-steel cursor-pointer">How this works</summary>
          <div className="mt-3 space-y-3 font-body text-sm text-steel">
            <p>
              Backfill training history from before {athleteName} joined: a recent PR, a working max, or a spreadsheet of past sessions. Every entry is flagged self-reported, not gym-verified, and feeds the AI program
              builder&apos;s training-max grounding without creating a fake logged workout or PR celebration.
            </p>
            <p>{IMPORT_BASELINE_NOTE}</p>
            <p>{IMPORT_UNITS_NOTE}</p>
            <HistoryImportAccessToggle
              groupId={params.groupId}
              athleteId={params.athleteId}
              athleteName={athleteName}
              initialEnabled={athleteMembership?.history_import_enabled ?? false}
            />
          </div>
        </details>
      </div>
    </CoachDesktopShell>
  );
}
