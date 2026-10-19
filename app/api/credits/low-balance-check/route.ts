import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getCallerGroupRole } from "@/lib/group-access";
import { rateLimitResponse } from "@/lib/rate-limit";

// Called right after a session is used (marked attended, a workout finished, a credit changed). It used to push to the coach and the organization's owner on the spot, one push per client, so marking five sessions was
// five pushes at once (Oct 19, 5:26 AM). It no longer sends anything: the running-low alerts are collected by the hourly job /api/cron/low-session-digest and go out as ONE digest push per person per day, in the coach's
// morning, each client once. This route stays only so the callers (and anything cached in a browser) keep working; it answers "nothing sent here".
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : null;
  const groupId = typeof body.groupId === "string" ? body.groupId : null;
  if (!athleteId || !groupId) return NextResponse.json({ error: "Missing athleteId or groupId." }, { status: 400 });

  const limited = await rateLimitResponse("low-balance-check", user.id, 120, 3600);
  if (limited) return limited;

  const role = await getCallerGroupRole(supabase, user.id, groupId);
  if (!role || (role === "athlete" && user.id !== athleteId)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  return NextResponse.json({ notified: null, queued: true });
}
