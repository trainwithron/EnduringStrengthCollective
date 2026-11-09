import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { validFixMinutes } from "@/lib/workout-time-fix";

// Correct how long a finished workout took (Ron, Nov 9: a timer left running shows 4 hours 12 minutes when it was about 60). Only the person who did the workout or a coach of its group.
// Only the time changes: the sets, pounds, PRs and date are left alone.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sessionId = body?.sessionId;
  const minutes = validFixMinutes(body?.minutes);
  if (typeof sessionId !== "string" || minutes == null) return NextResponse.json({ error: "Enter the minutes, from 1 to 600." }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: session } = await db.from("athlete_sessions").select("athlete_id, group_id, status").eq("id", sessionId).maybeSingle();
  if (!session || session.status !== "completed") return NextResponse.json({ error: "That workout isn't finished." }, { status: 404 });
  if (session.athlete_id !== user.id) {
    const { data: isCoach } = await supabase.rpc("is_group_coach", { _group_id: session.group_id });
    if (isCoach !== true) return NextResponse.json({ error: "You can't change this workout." }, { status: 403 });
  }

  const seconds = minutes * 60;
  const [{ error: logError }, { error: sessionError }] = await Promise.all([
    db.from("workout_logs").update({ total_duration_seconds: seconds }).eq("session_id", sessionId),
    db.from("athlete_sessions").update({ duration_seconds: seconds }).eq("id", sessionId),
  ]);
  if (logError || sessionError) return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
