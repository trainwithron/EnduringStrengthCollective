import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { programDayShape } from "@/lib/program-completeness";
import { ProgramCardGrid, type ProgramCardData } from "@/components/coach/desktop/program-card-grid";
import { computeProgramCardVisuals } from "@/lib/program-card-data";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { ALL_PROGRAMS_HREF } from "@/lib/programs-scope";

export default async function ProgramsListPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
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
      <NoAccess>Only coaches can manage programs.</NoAccess>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: programs, error: programsError } = await supabase
    .from("programs")
    .select(
      "id, name, is_active, ai_draft, cover_image_path, athlete_id, profiles!programs_athlete_id_fkey ( full_name ), workouts(id, group_workout_exercises(count))"
    )
    .eq("group_id", params.groupId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  const cards: ProgramCardData[] = (programs ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    isActive: p.is_active,
    aiDraft: p.ai_draft === true,
    ...programDayShape(p.workouts),
    coverImagePath: p.cover_image_path ?? null,
    athleteId: p.athlete_id,
    athleteName: p.profiles?.full_name ?? null,
  }));

  // Only worth computing for cards that'll actually show it (no manual
  // cover photo) — a program with a real uploaded photo never needs
  // this data at all.
  const uncoveredProgramIds = cards.filter((c) => !c.coverImagePath).map((c) => c.id);
  const visualsMap = await computeProgramCardVisuals(supabase, uncoveredProgramIds, user.id);
  const visualsByProgramId = Object.fromEntries(visualsMap);

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="programs">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          <SwappableTerm termKey="program" form="plural" className="capitalize" />
        </h1>
        <p className="font-body text-sm text-chalk mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
          <span>
            Showing only <span className="font-medium">{group?.name ?? "this group"}</span>&apos;s programs
          </span>
          <Link href={ALL_PROGRAMS_HREF} className="font-body text-sm text-rust underline underline-offset-2 min-h-11 sm:min-h-0 inline-flex items-center">
            Show all programs
          </Link>
        </p>
        <p className="font-body text-sm text-steel mt-2">
          {cards.length} {cards.length === 1 ? "program" : "programs"}
        </p>
        <div className="flex items-center gap-4 mt-4">
          <Link
            href={`/groups/${params.groupId}/programs/import`}
            className="font-body text-xs text-rust"
          >
            Import or build with AI →
          </Link>
          <Link
            href={`/groups/${params.groupId}/programs/new`}
            className="font-body text-xs text-rust"
          >
            + New program
          </Link>
        </div>
        <p className="font-body text-xs text-steel mt-1.5">
          Upload a spreadsheet, upload a photo of a program, or just describe what you want in
          plain English — AI writes the draft either way.
        </p>
      </div>

      {programsError ? (
        <UnavailableState what="your programs" />
      ) : (
        <ProgramCardGrid groupId={params.groupId} programs={cards} visualsByProgramId={visualsByProgramId} />
      )}
    </CoachDesktopShell>
  );
}
