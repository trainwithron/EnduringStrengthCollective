import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NewProgramForm } from "@/components/coach/new-program-form";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ImportWizard } from "@/components/coach/desktop/import-wizard";
import { AiExtractionGuide } from "@/components/coach/desktop/ai-extraction-guide";

export default async function NewProgramPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ method?: string; athleteId?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can create training programs.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  // Surfaced right here instead of only reachable via a separate "Import
  // or build with AI" page (live_walkthrough_round2_findings.md) — same
  // real ImportWizard/generate-program flow, not a second implementation.
  // A plain query param keeps this a real, bookmarkable/back-button-safe
  // tab instead of client-only toggle state, matching this app's existing
  // convention (e.g. the group Dashboard's ?scope=all tabs).
  const method = searchParams.method === "ai" ? "ai" : "blank";

  // "Build with AI for this client" (injury_pain_science_research_and_
  // ai_gap_sept15.md) — reached from ClientProgrammingMenu with a real
  // athleteId; verified against this group's own roster rather than
  // trusted at face value, same discipline as the API route's own check.
  let athleteName: string | null = null;
  if (searchParams.athleteId) {
    const { data: athleteMembership } = await supabase
      .from("group_memberships")
      .select("role, profiles ( full_name )")
      .eq("group_id", params.groupId)
      .eq("profile_id", searchParams.athleteId)
      .maybeSingle();
    if (athleteMembership?.role === "athlete") {
      athleteName = (athleteMembership.profiles as any)?.full_name ?? "this client";
    }
  }
  const athleteId = athleteName ? searchParams.athleteId! : null;

  const { data: libraryRows } =
    method === "ai"
      ? await supabase.from("exercise_library").select("name").eq("created_by", user.id).order("name")
      : { data: null };
  const { data: aliasRows } =
    method === "ai"
      ? await supabase.from("exercise_aliases").select("raw_name, exercise_name").eq("coach_id", user.id)
      : { data: null };

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="programs">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">New program</h1>
        <p className="font-body text-sm text-steel mt-2">
          A program is a training block — you&apos;ll add workouts to it next.
        </p>
        {athleteId && (
          <p className="font-body text-xs text-rust mt-2">
            Building a personal program for <span className="font-medium">{athleteName}</span>.
          </p>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        <Link
          href={`/groups/${params.groupId}/programs/new${athleteId ? `?athleteId=${athleteId}` : ""}`}
          className={`h-9 px-3.5 flex items-center font-body text-sm border ${
            method === "blank" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          Start blank
        </Link>
        <Link
          href={`/groups/${params.groupId}/programs/new?method=ai${athleteId ? `&athleteId=${athleteId}` : ""}`}
          className={`h-9 px-3.5 flex items-center font-body text-sm border ${
            method === "ai" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          Build with AI
        </Link>
      </div>

      {method === "blank" ? (
        <div className="max-w-lg">
          <NewProgramForm groupId={params.groupId} createdBy={user.id} />
        </div>
      ) : (
        <>
          <p className="font-body text-sm text-steel mb-4 max-w-[70ch]">
            Describe the program you want in plain English and AI writes a full draft — you&apos;ll
            review anything it had to guess on before it&apos;s actually created. Photo/spreadsheet
            import is also here if that&apos;s easier than typing.
          </p>
          <ImportWizard
            coachId={user.id}
            groupId={params.groupId}
            athleteId={athleteId}
            athleteName={athleteName}
            initialLibrary={libraryRows ?? []}
            initialAliases={(aliasRows ?? []).map((a) => ({ rawName: a.raw_name, exerciseName: a.exercise_name }))}
          />
          <AiExtractionGuide />
        </>
      )}
    </CoachDesktopShell>
  );
}
