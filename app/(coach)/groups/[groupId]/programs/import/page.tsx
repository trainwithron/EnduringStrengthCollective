import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ImportWizard } from "@/components/coach/desktop/import-wizard";

export default async function ImportProgramPage(
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
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can import programs.</NoAccess>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: libraryRows } = await supabase
    .from("exercise_library")
    .select("name")
    .eq("created_by", user.id)
    .order("name");

  const { data: aliasRows } = await supabase
    .from("exercise_aliases")
    .select("raw_name, exercise_name")
    .eq("coach_id", user.id);

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="programs">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <Link
          href={`/groups/${params.groupId}/programs`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to programs
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">
          Import or build with AI
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Describe a program, or drop in a spreadsheet, PDF, photo or pasted text. Exercises are matched against your library automatically, and you review everything before anything is created.
        </p>
      </div>

      <ImportWizard
        coachId={user.id}
        groupId={params.groupId}
        initialLibrary={libraryRows ?? []}
        initialAliases={(aliasRows ?? []).map((a) => ({ rawName: a.raw_name, exerciseName: a.exercise_name }))}
      />
    </CoachDesktopShell>
  );
}
