import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { loadAttendance } from "@/lib/attendance";
import { activityPeriod } from "@/lib/coach-activity";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { csvLine } from "@/lib/zip-store";

// The attendance of one group as a spreadsheet: one row per athlete per day they were present, with how (kiosk check-in, a finished workout, or a group session). A coach of the group only; read as the coach, so
// row security decides what is in it. If any part could not be read the file says so on its last row.
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
  if (coachRow?.role !== "coach") return NextResponse.json({ error: "Only a coach of this group can download its attendance." }, { status: 403 });

  const limited = await rateLimitResponse("attendance-csv", user.id, 30, 3600);
  if (limited) return limited;

  const { data: zoneRow } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  const timeZone = (zoneRow as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
  const period = activityPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, timeZone);
  const attendance = await loadAttendance(supabase, { groupId, fromIso: period.fromIso, toIso: period.toIso, fromDay: period.fromDay, toDay: period.toDay, timeZone });

  const lines = [csvLine(["athlete", "position", "date", "time_zone", "how"])];
  for (const a of attendance.athletes) {
    for (const day of Object.keys(a.days).sort()) lines.push(csvLine([a.name, a.positionName ?? "", day, timeZone, a.days[day].join(" + ")]));
  }
  if (attendance.failed || attendance.truncated) lines.push(csvLine(["INCOMPLETE: some of this could not be read. Do not use these totals; download again."]));
  lines.push(csvLine([`Present = checked in at the kiosk, finished a workout in this group, or attended a group session that day (${timeZone}).`]));

  return new Response("﻿" + lines.join(""), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${period.fromDay}-to-${period.toDay}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
