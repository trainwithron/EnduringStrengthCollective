import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { daysBetweenKeys } from "@/lib/date-key";
import { checkImportRow, IMPORT_MAX_SPAN_DAYS, type ImportedFoodRow } from "@/lib/nutrition-history-import";
import { REQUEST_MAX_ROWS, removeImportedHistory, saveImportedHistory } from "@/lib/nutrition-history-save";

// A coach bringing in a client's food history from another app (the "Upload nutrition history" panel on the client's Nutrition tab). The file is read in the coach's browser
// (lib/nutrition-history-import.ts); only the rows come here, a piece of whole days at a time. POST saves them as history only (food_source 'import': never counted as the
// client logging); DELETE takes every imported food for this client in this group back. Only the coach of the group, for a client in it. A client never writes their food log
// from here, and a coach cannot write anything else in it.
//
// Health data: the rows are never logged.
export const maxDuration = 60;

async function checkCaller(groupId: string, athleteId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  // The caller must coach this group (read as the caller, so row security decides), and the client must be an athlete in it.
  const { data: caller } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (caller?.role !== "coach") return { error: NextResponse.json({ error: "Only this client's coach can do that." }, { status: 403 }) };
  const serviceRole = createServiceRoleClient();
  const { data: member } = await serviceRole.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (member?.role !== "athlete") return { error: NextResponse.json({ error: "That person isn't a client in this group." }, { status: 404 }) };
  return { supabase, serviceRole, user };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";
  const athleteId = typeof body?.athleteId === "string" ? body.athleteId : "";
  const rawRows: unknown[] = Array.isArray(body?.rows) ? body.rows : [];
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing the client." }, { status: 400 });
  if (rawRows.length === 0) return NextResponse.json({ error: "There is nothing to save." }, { status: 400 });
  if (rawRows.length > REQUEST_MAX_ROWS) return NextResponse.json({ error: `Up to ${REQUEST_MAX_ROWS} foods can be sent at a time.` }, { status: 413 });

  const rows: ImportedFoodRow[] = [];
  for (const raw of rawRows) {
    const row = checkImportRow(raw);
    if (!row) return NextResponse.json({ error: "Some of the rows sent aren't valid food entries. Nothing was saved." }, { status: 400 });
    rows.push(row);
  }
  const dates = rows.map((r) => r.date).sort();
  if ((daysBetweenKeys(dates[0], dates[dates.length - 1]) ?? 0) > IMPORT_MAX_SPAN_DAYS) {
    return NextResponse.json({ error: "Up to 2 years can be brought in at once. Nothing was saved." }, { status: 400 });
  }

  const checked = await checkCaller(groupId, athleteId);
  if ("error" in checked) return checked.error;
  // A file is sent in a handful of pieces; this is far above any real use and stops a loop.
  const limited = await rateLimitResponse("nutrition-history-import", checked.user.id, 300, 3600);
  if (limited) return limited;

  const todayKey = dateKeyInZone(await getGroupCoachTimezone(checked.supabase, groupId));
  const result = await saveImportedHistory(checked.serviceRole, { athleteId, groupId, rows, todayKey });
  if (!result.ok) return NextResponse.json({ error: result.error, savedDays: result.savedDays, savedRows: result.savedRows }, { status: result.status });
  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";
  const athleteId = typeof body?.athleteId === "string" ? body.athleteId : "";
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing the client." }, { status: 400 });
  const checked = await checkCaller(groupId, athleteId);
  if ("error" in checked) return checked.error;
  const result = await removeImportedHistory(checked.serviceRole, { athleteId, groupId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result);
}
