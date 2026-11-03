import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";

// The coach's checkbox for a client aged 13 to 17 (step 199; Ron, Nov 3: "I talk to parents before they train with me"): "I've talked with their parent or guardian." Ticked, the client
// can start, the same as a signed permission; unticked, they are stopped again. The database checks the caller coaches a live group where the client trains, and records who and when.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const limited = await rateLimitResponse("guardian-coach-confirm", user.id, 60, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { athleteId?: unknown; confirmed?: unknown };
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  if (!athleteId) return NextResponse.json({ error: "Missing the client." }, { status: 400 });

  const { error } = await supabase.rpc("set_guardian_confirmed", { p_athlete: athleteId, p_confirmed: body.confirmed === true });
  if (error) {
    if (/not authorized/i.test(error.message)) return NextResponse.json({ error: "Only the client's coach can do that." }, { status: 403 });
    return NextResponse.json({ error: "That didn't save. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
