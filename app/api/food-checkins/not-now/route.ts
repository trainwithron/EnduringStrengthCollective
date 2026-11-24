import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { readPushPrefs } from "@/lib/push-prefs";
import { dateKeyInZone } from "@/lib/timezone";
import { checkinIsOpen } from "@/lib/food-checkin";

// "Not now" on the food check-in card (Nov 24): hidden for the rest of the client's day; it stays unanswered (and still counts as the week's check-in). Only their own. The body is { id }.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("food-checkin-not-now", user.id, 30, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const db = createServiceRoleClient();
  const { data: row } = await db.from("client_food_checkins").select("id, athlete_id, status, sent_at").eq("id", id).maybeSingle();
  if (!row || row.athlete_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!checkinIsOpen(row as { status: string; sent_at: string }, new Date())) return NextResponse.json({ ok: true });

  const today = dateKeyInZone((await readPushPrefs(db, user.id)).timeZone);
  const { error } = await db.from("client_food_checkins").update({ not_now_on: today }).eq("id", id).eq("status", "sent");
  if (error) return NextResponse.json({ error: "That didn't save. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
