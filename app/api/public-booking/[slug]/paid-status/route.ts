import { NextResponse } from "next/server";
import { cleanParam, limitByIp } from "@/lib/public-booking-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hashClaimToken } from "@/lib/client-claim-token";

// After paying (wave 3 C7), the visitor's page asks here how their booking went, with the secret from their return address. Only the state, the session and the time:
// no name, no email, nothing that would help someone holding a guessed address.
export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await props.params;
  if (!cleanParam(rawSlug, 40)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const limited = await limitByIp(request, "pb-paid-status-ip", 240, 3600);
  if (limited) return limited;
  const token = new URL(request.url).searchParams.get("s") ?? "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("public_booking_holds")
    .select("state, coach_id, start_at, amount_cents, session_types ( name ), profiles!public_booking_holds_coach_id_fkey ( full_name )")
    .eq("status_token_hash", hashClaimToken(token))
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Try again." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const row = data as any;
  const one = (v: any) => (Array.isArray(v) ? v[0] : v);
  // open or claimed: the payment is still coming through
  const { data: zone } = await db.rpc("coach_time_zone", { p_coach_id: row.coach_id });
  const state = row.state === "booked" ? "booked" : row.state === "refunded" ? "refunded" : row.state === "lapsed" ? "lapsed" : "waiting";
  return NextResponse.json(
    { state, startIso: row.start_at, timezone: typeof zone === "string" && zone ? zone : "America/New_York", amountCents: row.amount_cents, typeName: one(row.session_types)?.name ?? null, coachName: one(row.profiles)?.full_name ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
