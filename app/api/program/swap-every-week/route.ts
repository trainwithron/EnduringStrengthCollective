import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendCoachPush } from "@/lib/coach-notice";
import { cleanExerciseName, exerciseNameProblem } from "@/lib/exercise-name-guard";
import { clientSwapNotice, swapEveryWeek } from "@/lib/every-week-swap";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Every week" when an exercise is swapped during a workout (Ron, Nov 20: B5). The workout's own swap ("just today") is already saved by the logger; this changes the program from here
// on, through swap_exercise_every_week (step 219) run as the signed-in person, so the database decides: the client on their OWN one-on-one program, or a coach of the group logging for
// them. When the client did it, their coach is told (the bell, and a push under Client activity) with a link to the program, where it can be undone.
// The body is { sessionExerciseId, newName }.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionExerciseId = typeof body.sessionExerciseId === "string" && UUID.test(body.sessionExerciseId) ? body.sessionExerciseId : "";
  const newName = cleanExerciseName(typeof body.newName === "string" ? body.newName : "");
  if (!sessionExerciseId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const problem = exerciseNameProblem(newName);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const limited = await rateLimitResponse("swap-every-week", user.id, 30, 3600);
  if (limited) return limited;

  // the program exercise behind this workout's exercise (read as the person, so they must be able to see it)
  const { data: se, error: seError } = await supabase.from("session_exercises").select("id, group_workout_exercise_id, is_added").eq("id", sessionExerciseId).maybeSingle();
  if (seError) return NextResponse.json({ error: "Couldn't change the other weeks. Try again." }, { status: 502 });
  const templateId = (se as { group_workout_exercise_id?: string | null; is_added?: boolean } | null)?.group_workout_exercise_id;
  if (!se || !templateId || (se as { is_added?: boolean }).is_added) return NextResponse.json({ error: "This exercise isn't from a program, so there are no other weeks to change." }, { status: 422 });

  const done = await swapEveryWeek(supabase, templateId, newName, null);
  if (!done.ok) return NextResponse.json({ error: done.error }, { status: /own program/.test(done.error) ? 403 : /switched on/.test(done.error) ? 503 : 502 });
  const r = done.result;

  if (r.byClient && r.swap && r.group && r.program) {
    // best-effort: the change is saved whatever happens to the notice
    try {
      const db = createServiceRoleClient();
      const [{ data: me }, { data: coaches }] = await Promise.all([
        db.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
        db.from("group_memberships").select("profile_id").eq("group_id", r.group).eq("role", "coach"),
      ]);
      const name = ((me?.full_name as string | null) ?? "").trim() || "Your client";
      const text = clientSwapNotice(name, r.from, r.to);
      const link = `/groups/${r.group}/programs/${r.program}?swap=${r.swap}`;
      for (const c of (coaches ?? []) as { profile_id: string }[]) {
        if (c.profile_id === user.id) continue;
        await db.from("notifications").insert({ profile_id: c.profile_id, group_id: r.group, type: "exercise_swap", body: text, link_path: link });
        await sendCoachPush(db, c.profile_id, "client_activity", "Exercise swapped for every week", text, link).catch(() => 0);
      }
    } catch (e) {
      console.error("[swap-every-week] notice failed:", e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ ok: true, changed: r.changed, byClient: r.byClient }, { headers: { "Cache-Control": "no-store" } });
}
