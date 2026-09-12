import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ExerciseLibraryTabs } from "@/components/coach/exercise-library-tabs";
import type { EquipmentType } from "@/lib/equipment-classifier";

export default async function ExerciseLibraryPage(
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
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can manage the exercise library.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: libraryRows } = await supabase
    .from("exercise_library")
    .select("id, name, video_path, youtube_url, category, equipment_type")
    .eq("created_by", user.id)
    .order("name");

  const { data: tierRows } = await supabase
    .from("movement_pattern_exercises")
    .select("exercise_name, tier, movement_patterns!inner ( created_by )")
    .eq("movement_patterns.created_by", user.id);

  const tierByName = new Map<string, "A" | "B" | "C" | null>();
  for (const row of (tierRows ?? []) as any[]) {
    if (!tierByName.has(row.exercise_name)) tierByName.set(row.exercise_name, row.tier);
  }

  const exercises = (libraryRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    videoPath: r.video_path,
    youtubeUrl: r.youtube_url,
    tier: tierByName.get(r.name) ?? null,
    category: r.category as string | null,
    equipmentType: r.equipment_type as EquipmentType | null,
  }));

  const { data: patterns } = await supabase
    .from("movement_patterns")
    .select("id, name, plane, movement_pattern_exercises ( id, exercise_name, difficulty_rank, tier )")
    .eq("created_by", user.id)
    .order("name");

  const patternsWithLadder = (patterns ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    plane: p.plane,
    ladder: (p.movement_pattern_exercises ?? [])
      .slice()
      .sort((a: any, b: any) => a.difficulty_rank - b.difficulty_rank)
      .map((e: any) => ({ key: e.id, exerciseName: e.exercise_name, tier: e.tier })),
  }));

  const exerciseLibrary = exercises.map((e) => e.name);

  return (
    <CoachDesktopShell
      groupId={params.groupId}
      groupName={group?.name ?? "Coaching"}
      active="exercise-library"
    >
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          Exercise Library
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Every exercise you use across programs, plus the movement-pattern
          progression ladders you build from them.
        </p>
      </div>

      <ExerciseLibraryTabs
        coachId={user.id}
        initialExercises={exercises}
        initialPatterns={patternsWithLadder}
        exerciseLibrary={exerciseLibrary}
      />
    </CoachDesktopShell>
  );
}
