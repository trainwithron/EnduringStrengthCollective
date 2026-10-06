import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { shareHref } from "@/lib/share-token";

// Mints the link to a workout card for a workout that has no feed post. Only the client the workout belongs to (or their coach) can ask for it: the
// workout log is read with the caller's own access, so someone else's log is simply not found.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { workoutLogId?: string } | null;
  const id = body?.workoutLogId;
  if (!id || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Missing workout." }, { status: 400 });

  const { data: log } = await supabase.from("workout_logs").select("id, athlete_id, group_id").eq("id", id).maybeSingle();
  if (!log) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Only the client themselves or a coach of the group; a teammate who can read the row through the feed rules still cannot mint a link.
  let allowed = log.athlete_id === user.id;
  if (!allowed) {
    const { data: coach } = await supabase.from("group_memberships").select("role").eq("group_id", log.group_id).eq("profile_id", user.id).eq("role", "coach").maybeSingle();
    allowed = !!coach;
  }
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    return NextResponse.json({ href: shareHref(id) });
  } catch {
    return NextResponse.json({ error: "Sharing is not set up." }, { status: 503 });
  }
}
