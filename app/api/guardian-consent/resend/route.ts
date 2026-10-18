import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { requestGuardianConsent } from "@/lib/guardian-consent-server";

// A coach re-sends the request to the guardian address the client already gave ("Waiting on guardian" > Resend). Only a coach of the client; the address is the one on file, never one typed here. A new link replaces
// the old one.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { athleteId?: unknown };
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  if (!athleteId) return NextResponse.json({ error: "Missing the client." }, { status: 400 });

  // The coach must coach a group the client trains in (row security shows a coach only their own groups' members).
  const { data: seats } = await supabase.from("group_memberships").select("group_id").eq("profile_id", athleteId).eq("role", "athlete");
  const groupIds = (seats ?? []).map((s: { group_id: string }) => s.group_id);
  const { data: mine } = groupIds.length ? await supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach").in("group_id", groupIds).limit(1) : { data: [] };
  if (!mine || mine.length === 0) return NextResponse.json({ error: "Only the client's coach can do that." }, { status: 403 });

  const limited = await rateLimitResponse("guardian-resend", athleteId, 3, 3600);
  if (limited) return limited;

  const db = createServiceRoleClient();
  const { data: last } = await db.from("guardian_consents").select("guardian_email, status").eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const row = last as { guardian_email: string; status: string } | null;
  if (!row) return NextResponse.json({ error: "The client has not given a guardian's email yet. They do that when they sign in." }, { status: 400 });
  if (row.status === "signed") return NextResponse.json({ error: "A guardian has already given permission." }, { status: 409 });

  const result = await requestGuardianConsent(db, { athleteId, guardianEmail: row.guardian_email, requestedBy: user.id, origin: appOrigin(request) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
