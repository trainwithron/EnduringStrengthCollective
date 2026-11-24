import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";

// "Mark handled" on the coach's view of a food check-in (Nov 24): a coach of the client's group closes it, answered or not. The body is { id }.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("food-checkin-handle", user.id, 120, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Read as the coach: row security shows it only to the client and the coaches of its group, and the coach check below is the same rule.
  const { data: row } = await supabase.from("client_food_checkins").select("id, group_id, athlete_id, status").eq("id", id).maybeSingle();
  if (!row || row.athlete_id === user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: isCoach } = await supabase.rpc("is_group_coach", { _group_id: row.group_id });
  if (isCoach !== true) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const db = createServiceRoleClient();
  const { error } = await db
    .from("client_food_checkins")
    .update({ status: "handled", handled_by: user.id, handled_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["sent", "answered", "expired"]);
  if (error) return NextResponse.json({ error: "That didn't save. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
