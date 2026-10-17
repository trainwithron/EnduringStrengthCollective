import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
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

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can manage the exercise library.</NoAccess>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: libraryRows } = await supabase
    .from("exercise_library")
    .select("id, name, video_path, youtube_url, category, equipment_type, description")
    .eq("created_by", user.id)
    .order("name");

  const { data: tierRows } = await supabase
    .from("movement_pattern_exercises")
    .select("exercise_name, tier, is_unilateral, movement_patterns!inner ( created_by, name )")
    .eq("movement_patterns.created_by", user.id);

  // An exercise is sorted by being on one of the coach's pattern ladders: that ladder is its pattern, its mark is its class and side.
  const tagByName = new Map<string, { tier: "A" | "B" | "C" | null; pattern: string | null; unilateral: boolean }>();
  for (const row of (tierRows ?? []) as any[]) {
    if (!tagByName.has(row.exercise_name)) tagByName.set(row.exercise_name, { tier: row.tier, pattern: row.movement_patterns?.name ?? null, unilateral: !!row.is_unilateral });
  }

  const exercises = (libraryRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    videoPath: r.video_path,
    youtubeUrl: r.youtube_url,
    tier: tagByName.get(r.name)?.tier ?? null,
    pattern: tagByName.get(r.name)?.pattern ?? null,
    unilateral: tagByName.get(r.name)?.unilateral ?? false,
    category: r.category as string | null,
    equipmentType: r.equipment_type as EquipmentType | null,
    description: r.description as string | null,
  }));

  const { data: patterns } = await supabase
    .from("movement_patterns")
    .select("id, name, plane, movement_pattern_exercises ( id, exercise_name, difficulty_rank, tier, is_unilateral )")
    .eq("created_by", user.id)
    .order("name");

  const patternsWithLadder = (patterns ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    plane: p.plane,
    ladder: (p.movement_pattern_exercises ?? [])
      .slice()
      .sort((a: any, b: any) => a.difficulty_rank - b.difficulty_rank)
      .map((e: any) => ({ key: e.id, exerciseName: e.exercise_name, tier: e.tier, unilateral: !!e.is_unilateral, rank: e.difficulty_rank as number })),
  }));

  const exerciseLibrary = exercises.map((e) => e.name);

  // corrective_exercise_biomechanical_tagging_idea.md — the vocabulary
  // is a small (~60-row), fully-shared reference set, fetched once here
  // rather than per-row; the actual tags are looked up only for this
  // coach's own exercise names (the join key), not the whole platform's.
  const [{ data: biomechTagRows }, { data: exerciseTagRows }] = await Promise.all([
    supabase
      .from("biomech_tags")
      .select("id, kind, key, label, joint, description")
      .order("kind", { ascending: true })
      .order("joint", { ascending: true })
      .order("label", { ascending: true }),
    exerciseLibrary.length > 0
      ? supabase
          .from("exercise_biomech_tags")
          .select("exercise_name, tag_id, role")
          .in("exercise_name", exerciseLibrary)
      : Promise.resolve({ data: [] as { exercise_name: string; tag_id: string; role: string }[] }),
  ]);

  const biomechVocabulary = (biomechTagRows ?? []).map((t) => ({
    id: t.id,
    kind: t.kind as "joint_action" | "stabilization",
    key: t.key,
    label: t.label,
    joint: t.joint,
    description: t.description,
  }));

  const initialBiomechTagsByExercise: Record<string, { tagId: string; role: "prime_mover" | "stabilizer_demand" }[]> = {};
  for (const row of exerciseTagRows ?? []) {
    const list = initialBiomechTagsByExercise[row.exercise_name] ?? [];
    list.push({ tagId: row.tag_id, role: row.role as "prime_mover" | "stabilizer_demand" });
    initialBiomechTagsByExercise[row.exercise_name] = list;
  }

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
        groupId={params.groupId}
        coachId={user.id}
        initialExercises={exercises}
        initialPatterns={patternsWithLadder}
        exerciseLibrary={exerciseLibrary}
        biomechVocabulary={biomechVocabulary}
        initialBiomechTagsByExercise={initialBiomechTagsByExercise}
      />
    </CoachDesktopShell>
  );
}
