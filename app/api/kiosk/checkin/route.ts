import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// The kiosk screen never ships the real PIN to the browser (the roster
// fetch only sends hasPin, not the value) — verifying it has to be a
// server round trip. Runs under the coach's own authenticated session
// (the kiosk tablet is signed in as the coach, never the athlete —
// same precedent as app/groups/[groupId]/display/page.tsx), so no
// service-role client is needed: RLS already lets this coach read
// kiosk_pin and write kiosk_checkins for their own group.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json();
  const { groupId, athleteId, pin } = body as {
    groupId?: string;
    athleteId?: string;
    pin?: string;
  };
  if (!groupId || !athleteId || !pin) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (coachMembership?.role !== "coach") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { data: athleteMembership } = await supabase
    .from("group_memberships")
    .select("kiosk_pin")
    .eq("group_id", groupId)
    .eq("profile_id", athleteId)
    .eq("role", "athlete")
    .maybeSingle();

  if (!athleteMembership?.kiosk_pin) {
    return NextResponse.json({ error: "No PIN set for this athlete yet — ask your coach." }, { status: 400 });
  }
  if (athleteMembership.kiosk_pin !== pin) {
    return NextResponse.json({ error: "Wrong PIN — try again." }, { status: 401 });
  }

  const { data: checkin, error } = await supabase
    .from("kiosk_checkins")
    .insert({ group_id: groupId, athlete_id: athleteId })
    .select("checked_in_at")
    .single();

  if (error || !checkin) {
    return NextResponse.json({ error: "Couldn't check in — try again." }, { status: 500 });
  }

  return NextResponse.json({ checkedInAt: checkin.checked_in_at });
}
