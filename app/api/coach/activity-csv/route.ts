import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { activityPeriod, loadCoachActivity, MAX_RATE_CENTS } from "@/lib/coach-activity";
import { csvLine } from "@/lib/zip-store";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";

// The sessions behind the Coach activity numbers, one row each, as a spreadsheet: coach, date, client, session type, the booking it comes from, and the rate typed for that coach (an estimate, in cents).
// Owner or admin only; read as the signed-in person, so row security decides which clients are in it. If any part could not be read the file says so on its last row instead of looking complete.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId") ?? "";
  if (!groupId) return NextResponse.json({ error: "Missing the group." }, { status: 400 });

  const { data: coachRow } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (coachRow?.role !== "coach") return NextResponse.json({ error: "Only a coach of this organization can open this." }, { status: 403 });
  const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  const orgId = (group as { organization_id?: string } | null)?.organization_id;
  const { data: orgRow } = orgId ? await supabase.from("organization_memberships").select("role").eq("organization_id", orgId).eq("profile_id", user.id).maybeSingle() : { data: null };
  if (!orgId || (orgRow?.role !== "owner" && orgRow?.role !== "admin")) return NextResponse.json({ error: "Only the owner and admins can download this." }, { status: 403 });

  const limited = await rateLimitResponse("coach-activity-csv", user.id, 20, 3600);
  if (limited) return limited;

  const { data: zoneRow } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  const timeZone = (zoneRow as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
  const period = activityPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, timeZone);
  const activity = await loadCoachActivity(supabase, { orgId, fromIso: period.fromIso, toIso: period.toIso });

  const rate = (coachId: string) => {
    const n = Number(url.searchParams.get(`rate_${coachId}`));
    return Number.isInteger(n) && n > 0 && n <= MAX_RATE_CENTS ? n : 0;
  };
  const lines = [csvLine(["coach", "date", "time_zone", "client", "session_type", "booking_id", "estimate_cents"])];
  for (const s of activity.sessionLines) lines.push(csvLine([s.coachName, dateKeyInZone(timeZone, new Date(s.startAt)), timeZone, s.clientName, s.sessionType, s.bookingId, rate(s.coachId)]));
  if (activity.failed || activity.truncated) lines.push(csvLine(["INCOMPLETE: some of this could not be read. Do not use these totals; download again."]));
  lines.push(csvLine([`Days run midnight to midnight in ${timeZone}.`]));
  lines.push(csvLine(["Estimate only, not payroll. Sessions delivered = confirmed, time passed, not a no-show. Clients private from the organization are not included."]));

  return new Response("﻿" + lines.join(""), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="coach-sessions-${period.fromDay}-to-${period.toDay}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
