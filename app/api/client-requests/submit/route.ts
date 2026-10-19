import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { limitByIp } from "@/lib/public-booking-route";
import { isRealCalendarDate, requestTargetFor } from "@/lib/client-requests";

// A SIGNED-IN person sends a request to train with a coach, from the coach's public page. The body is only { slug, dob }: no message and no link of any kind. The database function does the checking (the page is on and
// taking requests, under 13, already a client, a second request, the 30-day wait, the limits) and writes nothing but the waiting request: no seat, no data. It ANSWERS with {ok, id} or {ok: false, code, message}, so
// even a refused try is recorded for the limits. This route only finds the coach by the page's address, limits the pace and passes the plain-words answer on.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first.", code: "not_signed_in" }, { status: 401 });
  const limited = (await limitByIp(request, "client-request-submit-ip", 60, 3600)) ?? (await rateLimitResponse("client-request-submit", user.id, 30, 3600));
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const slug = typeof raw?.slug === "string" ? raw.slug : "";
  const dob = typeof raw?.dob === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.dob) ? raw.dob : null;
  // a date shaped like a date that is not a day on the calendar (2020-13-45) is answered here in plain words, not passed on to fail in the database
  if (dob !== null && !isRealCalendarDate(dob)) return NextResponse.json({ error: "That date of birth is not a real date.", code: "dob_invalid" }, { status: 400 });

  const target = await requestTargetFor(createServiceRoleClient(), slug);
  if (!target) return NextResponse.json({ error: "This coach isn't taking requests through this page.", code: "not_taking" }, { status: 404 });

  const { data, error } = await supabase.rpc("submit_client_request", { p_coach: target.coachId, p_dob: dob });
  const out = data as { ok?: boolean; id?: string; code?: string; message?: string } | null;
  if (error || !out) return NextResponse.json({ error: "Couldn't send the request. Try again.", code: "failed" }, { status: 502 });
  if (out.ok !== true) {
    const code = out.code ?? "failed";
    return NextResponse.json({ error: out.message ?? "Couldn't send the request.", code }, { status: code === "too_many" ? 429 : 409 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
