import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// A coach cancels a guardian's permission on file (for example, they phoned the parent and the person who signed was not them). The signed record is kept, marked withdrawn with who did it; the client is stopped
// again on their next page. Only a coach of the client.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { athleteId?: unknown };
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  if (!athleteId) return NextResponse.json({ error: "Missing the client." }, { status: 400 });

  const { data: seats } = await supabase.from("group_memberships").select("group_id").eq("profile_id", athleteId).eq("role", "athlete");
  const groupIds = (seats ?? []).map((s: { group_id: string }) => s.group_id);
  const { data: mine } = groupIds.length ? await supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach").in("group_id", groupIds).limit(1) : { data: [] };
  if (!mine || mine.length === 0) return NextResponse.json({ error: "Only the client's coach can do that." }, { status: 403 });

  const { data: voided, error } = await createServiceRoleClient()
    .from("guardian_consents")
    .update({ status: "withdrawn", withdrawn_at: new Date().toISOString(), voided_by: user.id })
    .eq("athlete_id", athleteId)
    .eq("status", "signed")
    .select("id");
  if (error) return NextResponse.json({ error: "Couldn't do that. Try again." }, { status: 502 });
  if (!voided || voided.length === 0) return NextResponse.json({ error: "There is no permission on file to cancel." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
