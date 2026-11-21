import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { activityPeriod, loadCoachActivity } from "@/lib/coach-activity";
import { buildPayrollSnapshot, cleanNote, cleanRates } from "@/lib/payroll-report";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

// "Save this pay period" on Coach activity ($3, Ron Nov 20). The owner or an admin of the organization only. The numbers are worked out again here, under their own sign-in,
// exactly as the page works them out (so row security decides who is counted), with the rates they typed; a period that could not be read in full is not saved. The row is
// written with the server's key because nobody writes payroll_reports from a browser (migration 0464); once saved it never changes.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { groupId?: unknown; from?: unknown; to?: unknown; rates?: unknown; note?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // handled below as a missing group
  }
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  if (!groupId) return NextResponse.json({ error: "Missing the group." }, { status: 400 });

  const { data: coachRow } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (coachRow?.role !== "coach") return NextResponse.json({ error: "Only a coach of this organization can save this." }, { status: 403 });
  const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  const orgId = (group as { organization_id?: string } | null)?.organization_id;
  const { data: orgRow } = orgId ? await supabase.from("organization_memberships").select("role").eq("organization_id", orgId).eq("profile_id", user.id).maybeSingle() : { data: null };
  if (!orgId || (orgRow?.role !== "owner" && orgRow?.role !== "admin")) return NextResponse.json({ error: "Only the owner and admins can save a pay period." }, { status: 403 });

  const limited = await rateLimitResponse("coach-payroll-save", user.id, 20, 3600);
  if (limited) return limited;

  const { data: zoneRow } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  const timeZone = (zoneRow as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
  const period = activityPeriod(typeof body.from === "string" ? body.from : undefined, typeof body.to === "string" ? body.to : undefined, timeZone);
  const activity = await loadCoachActivity(supabase, { orgId, fromIso: period.fromIso, toIso: period.toIso });
  if (activity.failed || activity.truncated) {
    return NextResponse.json({ error: "Some of this period could not be read, so it was not saved. Reload the page and try again, or choose a shorter period." }, { status: 409 });
  }

  const snapshot = buildPayrollSnapshot(activity, period, cleanRates(body.rates));
  const { data: saved, error } = await createServiceRoleClient()
    .from("payroll_reports")
    .insert({ organization_id: orgId, created_by: user.id, from_day: period.fromDay, to_day: period.toDay, time_zone: period.timeZone, note: cleanNote(body.note), snapshot })
    .select("id")
    .single();
  if (error || !saved) {
    console.error("[payroll reports] could not save:", error?.message);
    return NextResponse.json({ error: "Couldn't save the pay period. Try again." }, { status: 500 });
  }
  return NextResponse.json({ id: (saved as { id: string }).id });
}
