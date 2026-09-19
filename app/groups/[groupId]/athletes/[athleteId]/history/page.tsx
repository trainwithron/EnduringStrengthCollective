import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ExerciseHistoryUploader } from "@/components/coach/exercise-history-uploader";
import { HistoryImportAccessToggle } from "@/components/coach/history-import-access-toggle";

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

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can upload a client&apos;s exercise history.</p>
      </main>
    );
  }

  const [{ data: group }, { data: athleteProfile }, { data: athleteMembership }, { data: libraryRows }] =
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
        <h1 className="font-display font-bold text-2xl uppercase mb-1">{athleteName}&apos;s exercise history</h1>
        <p className="font-body text-sm text-steel mb-6 max-w-2xl">
          Backfill training history from before {athleteName} joined — a recent PR, a working max, or a spreadsheet
          of past sessions. Every entry is flagged self-reported, not gym-verified, and feeds the AI program
          builder&apos;s training-max grounding without creating a fake logged workout or PR celebration.
        </p>

        <div className="mb-8">
          <HistoryImportAccessToggle
            groupId={params.groupId}
            athleteId={params.athleteId}
            athleteName={athleteName}
            initialEnabled={athleteMembership?.history_import_enabled ?? false}
          />
        </div>

        <ExerciseHistoryUploader
          athleteId={params.athleteId}
          groupId={params.groupId}
          exerciseSuggestions={exerciseSuggestions}
          viewerIsCoach
        />
      </div>
    </CoachDesktopShell>
  );
}
