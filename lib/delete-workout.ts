// Delete workout (components/session/complete-workout-button.tsx), done on the server so a video the COACH recorded during a client's workout is
// removed too (the client's own storage rights stop at their own uploads).
//   1. Only the session id comes in. The caller's own client reads the workout first: a stranger cannot see it and is refused.
//   2. Only its athlete or a coach of its group may delete it, and only while it is still in progress.
//   3. The video paths are read here, from this workout's own rows (never from the browser), and only paths in this workout's own folders are kept.
//   4. The workout is deleted with the caller's own client (row security still applies); its exercises, sets and video rows go with it.
//   5. Then the files are removed with the service role. A storage failure is logged and does not undo the delete.
// Records (PRs) are only written when a workout is completed, so an in-progress one has none to take back.

export type DeleteWorkoutResult = { status: 200; removedVideos: number } | { status: 400 | 403 | 404 | 409 | 500; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const VIDEO_BUCKET = "athlete-exercise-videos";

// A path is this workout's only when it sits in the folder the upload writes to: `${groupId}/${sessionExerciseId}/<file>`.
export function ownVideoPaths(groupId: string, rows: { session_exercise_id: string; video_path: string | null }[], exerciseIds: Set<string>): string[] {
  return rows
    .filter((r) => r.video_path && exerciseIds.has(r.session_exercise_id))
    .map((r) => ({ path: r.video_path as string, folder: `${groupId}/${r.session_exercise_id}/` }))
    .filter(({ path, folder }) => path.startsWith(folder) && path.length > folder.length && !path.slice(folder.length).includes("/") && !path.includes(".."))
    .map(({ path }) => path);
}

export async function deleteInProgressWorkout(input: { db: any; admin: any; userId: string; sessionId: unknown }): Promise<DeleteWorkoutResult> {
  const { db, admin, userId } = input;
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  if (!UUID.test(sessionId)) return { status: 400, error: "No workout was named." };

  const { data: session } = await db.from("athlete_sessions").select("id, athlete_id, group_id, status").eq("id", sessionId).maybeSingle();
  if (!session) return { status: 404, error: "This workout couldn't be deleted. Nothing was changed." };
  let allowed = session.athlete_id === userId;
  if (!allowed) {
    const { data: coachRow } = await db.from("group_memberships").select("id").eq("group_id", session.group_id).eq("profile_id", userId).eq("role", "coach").maybeSingle();
    allowed = !!coachRow;
  }
  if (!allowed) return { status: 403, error: "This workout couldn't be deleted. Nothing was changed." };
  if (session.status !== "in_progress") return { status: 409, error: "Only a workout that is still going can be deleted. Nothing was changed." };

  const { data: exerciseRows, error: exerciseError } = await admin.from("session_exercises").select("id").eq("session_id", sessionId);
  if (exerciseError) return { status: 500, error: "This workout couldn't be deleted. Nothing was changed." };
  const exerciseIds = new Set<string>((exerciseRows ?? []).map((r: { id: string }) => r.id));
  let paths: string[] = [];
  if (exerciseIds.size > 0) {
    const { data: videoRows, error: videoError } = await admin.from("session_exercise_videos").select("session_exercise_id, video_path").in("session_exercise_id", [...exerciseIds]);
    if (videoError) return { status: 500, error: "This workout couldn't be deleted. Nothing was changed." };
    paths = ownVideoPaths(session.group_id, videoRows ?? [], exerciseIds);
  }

  const { data: deleted, error: deleteError } = await db.from("athlete_sessions").delete().eq("id", sessionId).eq("status", "in_progress").select("id");
  if (deleteError || !deleted || deleted.length === 0) return { status: 409, error: "This workout couldn't be deleted. Nothing was changed." };

  let removedVideos = 0;
  if (paths.length > 0) {
    const { data: removed, error: storageError } = await admin.storage.from(VIDEO_BUCKET).remove(paths);
    removedVideos = removed?.length ?? 0;
    if (storageError || removedVideos < paths.length) console.error("Delete workout: the workout is deleted, but its videos could not all be removed from storage", sessionId, paths, storageError?.message ?? "not all removed");
  }
  return { status: 200, removedVideos };
}
