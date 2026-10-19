import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The signed-in coach answers a waiting request, or declines every waiting request in the organization they are working in with one tap. The database functions check that it is the coach's own request and still waiting,
// make the client's own one-on-one space (for an approval) and tell the person in plain words.
// { id, action: "approve" | "decline" }   or   { organizationId, action: "decline_all" }
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("client-request-answer", user.id, 120, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);

  if (raw?.action === "decline_all") {
    const organizationId = typeof raw.organizationId === "string" && UUID.test(raw.organizationId) ? raw.organizationId : "";
    if (!organizationId) return NextResponse.json({ error: "Missing the organization." }, { status: 400 });
    const { data, error } = await supabase.rpc("decline_all_client_requests", { p_org: organizationId });
    if (error || typeof data !== "number") return NextResponse.json({ error: "Couldn't decline them. Try again." }, { status: 502 });
    return NextResponse.json({ ok: true, declined: data });
  }

  const id = raw && typeof raw.id === "string" && UUID.test(raw.id) ? raw.id : "";
  const action = raw?.action === "approve" || raw?.action === "decline" ? raw.action : "";
  if (!id || !action) return NextResponse.json({ error: "Missing the request." }, { status: 400 });

  if (action === "decline") {
    const { error } = await supabase.rpc("decline_client_request", { p_request: id });
    if (error) return NextResponse.json({ error: /already answered/.test(error.message) ? "That request was already answered." : /not found/.test(error.message) ? "That request was not found." : "Couldn't decline it. Try again." }, { status: /not found|already/.test(error.message) ? 409 : 502 });
    return NextResponse.json({ ok: true });
  }
  const { data, error } = await supabase.rpc("approve_client_request", { p_request: id });
  if (error) {
    const m = error.message;
    if (/already answered/.test(m)) return NextResponse.json({ error: "That request was already answered." }, { status: 409 });
    if (/not found/.test(m)) return NextResponse.json({ error: "That request was not found." }, { status: 409 });
    return NextResponse.json({ error: "Couldn't approve it. Try again." }, { status: 502 });
  }
  const out = data as { ok?: boolean; group_id?: string; age_band?: string; code?: string; message?: string } | null;
  // a request the coach cannot take (they left the organization, the person is under 13, or the date of birth on file needs support to correct) is not approved
  if (out && out.ok === false) return NextResponse.json({ ok: false, code: out.code ?? "closed", error: out.message ?? "That request was closed." }, { status: 200 });
  return NextResponse.json({ ok: true, groupId: out?.group_id ?? null, ageBand: out?.age_band ?? "unknown" });
}
