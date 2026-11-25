import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";

// The coach's checkbox for a client with no birthday on file (step 230; Ron, Nov 24: "I can vouch for everyone that doesn't have a birthday submitted. They are over 18."):
// "18 or older (no birthday on file)". Ticked, the client counts as an adult everywhere a birthday of 18 or over would; unticked, an unknown age is treated as under 18 again.
// The database checks the caller coaches a live group where the client trains, refuses it once a birthday is on file, and records who and when.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const limited = await rateLimitResponse("adult-coach-confirm", user.id, 60, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { athleteId?: unknown; confirmed?: unknown };
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  if (!athleteId) return NextResponse.json({ error: "Missing the client." }, { status: 400 });

  const { error } = await supabase.rpc("set_adult_confirmed", { p_athlete: athleteId, p_confirmed: body.confirmed === true });
  if (error) {
    if (/not authorized/i.test(error.message)) return NextResponse.json({ error: "Only the client's coach can do that." }, { status: 403 });
    if (/birthday on file/i.test(error.message)) return NextResponse.json({ error: "This client has a birthday on file, so their age comes from it." }, { status: 409 });
    return NextResponse.json({ error: "That didn't save. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
