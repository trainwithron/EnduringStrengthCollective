import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";

// "Keep my clients and everything: start my own account." A coach who is leaving an organization (and was not let go, and is still inside their seven days) gets an organization they own; the groups they kept, their
// shop links, classes, session types and calendar move into it, and it starts on the standard free trial like any new coach's. The database does the move (complete_departure, server only) and refuses anyone else;
// the coach is always the signed-in person, never read from the request.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("start-own-account", user.id, 5, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  if (!organizationId) return NextResponse.json({ error: "Missing the organization." }, { status: 400 });

  const db = createServiceRoleClient();
  const { data, error } = await db.rpc("complete_departure", { p_org: organizationId, p_coach: user.id });
  if (error) {
    const known = /let go|seven days|not leaving|owner of an organization/.test(error.message);
    return NextResponse.json({ error: known ? error.message : "Couldn't start your account. Try again." }, { status: known ? 403 : 500 });
  }
  return NextResponse.json({ ok: true, organizationId: (data as { organization_id?: string } | null)?.organization_id ?? null });
}
