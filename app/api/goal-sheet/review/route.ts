import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { goalSheetActor } from "@/lib/goal-sheet-server";

// "Still my goal" on the 90-day goal card (Ron, Nov 20: R5): the client confirms their goal sheet, which stamps client_goal_sheets.reviewed_at (step 215) and starts the 90 days
// again. Only the client, for their own sheet, and only a sheet they have (signed-in people cannot write the table; this route checks who is asking, as /api/goal-sheet does).
// The body is { groupId, athleteId }.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("goal-sheet-review", user.id, 20, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { groupId?: unknown; athleteId?: unknown };
  const db = createServiceRoleClient();
  const actor = await goalSheetActor(supabase, db, user.id, body.groupId, body.athleteId);
  if (actor?.role !== "client") return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data, error } = await db
    .from("client_goal_sheets")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("athlete_id", user.id)
    .eq("group_id", body.groupId as string)
    .not("filled_at", "is", null)
    .select("athlete_id");
  if (error || !data || data.length === 0) return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
