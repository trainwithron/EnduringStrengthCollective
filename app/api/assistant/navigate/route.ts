import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { resolveNavigation, type NavContext, type RosterClient } from "@/lib/nav-intents";
import { normalizeForLog } from "@/lib/nav-query-log";

// Ask Spot's free first step. A "take me to ...", "how do I ..." or "open Jordan's profile" request is answered here from the
// app's own route table and how-to library, with no AI call, so it costs nothing and works when AI is off or out of credits.
// Only a real question about a person's data goes on to the AI chat. What it could not answer is logged as normalized text
// with names removed (nav_query_log) so missing phrasings can be added. Logging is best-effort and never blocks the answer.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const limited = await rateLimitResponse("nav-help", user.id, 180, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
  if (!message) return NextResponse.json({ error: "A message is required." }, { status: 400 });
  const pagePath = typeof body.pagePath === "string" ? body.pagePath.slice(0, 300) : "";
  const device = Number(body.viewportWidth) > 0 && Number(body.viewportWidth) < 768 ? "phone" : "desktop";

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("group_id, role")
    .eq("profile_id", user.id);
  const coachGroupIds = (memberships ?? []).filter((m: any) => m.role === "coach").map((m: any) => m.group_id as string);
  const role = coachGroupIds.length > 0 ? "coach" : "athlete";
  const ownGroupIds = role === "coach" ? coachGroupIds : (memberships ?? []).map((m: any) => m.group_id as string);
  if (ownGroupIds.length === 0) {
    return NextResponse.json({ kind: "unsure", text: "Join a group first, then I can help you find your way around.", chips: [], steps: [], intentIds: [] });
  }

  // The group the person is looking at, when their page says so and they belong to it. Otherwise their first group.
  const pathGroup = pagePath.match(new RegExp(`^/groups/(${UUID})`))?.[1] ?? null;
  const groupId = pathGroup && ownGroupIds.includes(pathGroup) ? pathGroup : ownGroupIds[0];

  let roster: RosterClient[] = [];
  if (role === "coach") {
    const { data: rows } = await supabase
      .from("group_memberships")
      .select("group_id, profile_id, role, profiles ( full_name )")
      .in("group_id", coachGroupIds)
      .eq("role", "athlete")
      .limit(600);
    roster = (rows ?? [])
      .map((r: any) => ({ id: r.profile_id as string, fullName: (r.profiles?.full_name as string | undefined) ?? "", groupId: r.group_id as string }))
      .filter((r) => r.fullName);
  }

  const athleteFromPath = pagePath.match(new RegExp(`/athletes/(${UUID})`))?.[1] ?? null;
  const ctx: NavContext = {
    role,
    device,
    groupId,
    currentAthleteId: athleteFromPath && roster.some((r) => r.id === athleteFromPath) ? athleteFromPath : null,
    roster,
  };

  const result = resolveNavigation(message, ctx);

  // Best-effort log. Text is kept only for what was not answered, with names removed.
  const outcome = result.kind;
  const intentIds = result.kind === "data" ? [] : result.intentIds;
  const keepText = outcome === "unsure" || outcome === "data";
  try {
    await createServiceRoleClient()
      .from("nav_query_log")
      .insert({ role, device, outcome, intent_ids: intentIds, query_text: keepText ? normalizeForLog(message, roster) : null });
  } catch {
    // Table not there yet, or the write failed: the person still gets their answer.
  }

  if (result.kind === "data") return NextResponse.json({ kind: "data", chips: result.chips });
  if (result.kind === "howto") {
    return NextResponse.json({ kind: "howto", text: result.text, steps: result.steps, note: result.note ?? null, chips: result.chips });
  }
  return NextResponse.json({ kind: result.kind, text: result.text, chips: result.chips });
}
