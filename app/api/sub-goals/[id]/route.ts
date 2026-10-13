import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { nextSubGoalStatus, type SubGoalAction, type SubGoalStatus } from "@/lib/sub-goals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["agree", "decline", "done"]);

// Agree, say not now, or mark done on one smaller goal. Signed-in people have no right to change these rows themselves: this route checks that the caller is the client or a coach of the group,
// then applies the one allowed step (lib/sub-goals.ts). The side that added it cannot answer its own proposal.
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("sub-goal-act", user.id, 120, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" && ACTIONS.has(body.action) ? (body.action as SubGoalAction) : null;
  if (!action) return NextResponse.json({ error: "That didn't work. Try again." }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: row } = await db.from("client_sub_goals").select("id, athlete_id, group_id, proposed_by, status").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  let allowed = row.athlete_id === user.id;
  if (!allowed) {
    const { data: seat } = await db.from("group_memberships").select("role").eq("group_id", row.group_id).eq("profile_id", user.id).maybeSingle();
    allowed = seat?.role === "coach";
  }
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const next = nextSubGoalStatus({ status: row.status as SubGoalStatus, proposedBy: row.proposed_by, actorId: user.id, action });
  if (!next) return NextResponse.json({ error: "That can't be done right now." }, { status: 409 });
  const now = new Date().toISOString();
  const patch = next === "done" ? { status: next, done_at: now } : { status: next, responded_by: user.id, responded_at: now };
  const { error } = await db.from("client_sub_goals").update(patch).eq("id", id).eq("status", row.status);
  if (error) return NextResponse.json({ error: "That didn't work. Try again." }, { status: 500 });
  return NextResponse.json({ status: next });
}
