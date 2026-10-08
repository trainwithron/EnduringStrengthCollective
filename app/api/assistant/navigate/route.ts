import { describeScheduleRequests, matchScheduleRequestQuestion, namedClients } from "@/lib/schedule-requests-chat";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { resolveNavigation, type NavContext, type RosterClient } from "@/lib/nav-intents";
import { normalizeForLog } from "@/lib/nav-query-log";
import { proposeAction } from "@/lib/assistant-actions-server";

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

  // A plain settings command ("set my buffer to 10 minutes") is turned into one typed action and shown as a before/after card; nothing changes until the
  // coach confirms it (app/api/assistant/action). Only for coaches, and only for the small set of settings in lib/assistant-actions.ts.
  if (role === "coach") {
    try {
      // The page's own group only (never "the first group"), so a word change says which organization it is for and never guesses one.
      const proposal = await proposeAction(supabase, user.id, message, pathGroup && ownGroupIds.includes(pathGroup) ? pathGroup : null);
      if (proposal) {
        if (!proposal.ok) return NextResponse.json({ kind: "unsure", text: proposal.message, chips: [], steps: [], intentIds: [] });
        return NextResponse.json({ kind: "action", card: proposal.card });
      }
    } catch {
      return NextResponse.json({ kind: "unsure", text: "I couldn't set that up right now, so nothing was changed. You can change it by hand in your settings.", chips: [], steps: [], intentIds: [] });
    }
  }

  // "Any schedule requests?" / "who asked to pause?": a read-only answer for coaches, from the requests their own sign-in can see (never the clients' private notes). It
  // changes nothing; the card on the dashboard is where a request is handled.
  if (role === "coach" && matchScheduleRequestQuestion(message)) {
    try {
      const { data: requestRows, error: requestError } = await supabase
        .from("schedule_requests")
        .select("athlete_id, kind, effective_on, resume_on")
        .in("status", ["pending", "applying"])
        .order("effective_on", { ascending: true })
        .limit(40);
      if (!requestError) {
        const nameById = new Map(roster.map((r) => [r.id, r.fullName]));
        const named = namedClients(message, roster);
        const lines = ((requestRows ?? []) as { athlete_id: string; kind: "pause" | "freeze" | "cancel"; effective_on: string; resume_on: string | null }[])
          .filter((r) => named.length === 0 || named.some((n) => n.id === r.athlete_id))
          .map((r) => ({ clientName: nameById.get(r.athlete_id) ?? "A client", kind: r.kind, effectiveOn: r.effective_on, resumeOn: r.resume_on }));
        return NextResponse.json({ kind: "navigate", text: describeScheduleRequests(lines, named.map((n) => n.fullName)), chips: [{ label: "Open my dashboard", href: "/dashboard" }], confirm: null, preview: null });
      }
    } catch {
      // Not set up yet, or it failed: fall through to the usual answers.
    }
  }

  // Each client's current program (their own copy when they have one, else the group's), so "Johann's program" opens the right screen. Ids only.
  const clientPrograms: Record<string, { programId: string; groupId: string }> = {};
  if (role === "coach" && roster.length > 0) {
    const { data: programRows } = await supabase
      .from("programs")
      .select("id, group_id, athlete_id")
      .in("group_id", coachGroupIds)
      .eq("is_active", true)
      .limit(1000);
    const rows = (programRows ?? []) as { id: string; group_id: string; athlete_id: string | null }[];
    for (const c of roster) {
      const own = rows.find((r) => r.athlete_id === c.id && r.group_id === c.groupId);
      const shared = rows.find((r) => r.athlete_id === null && r.group_id === c.groupId);
      const pick = own ?? shared;
      if (pick) clientPrograms[c.id] = { programId: pick.id, groupId: pick.group_id };
    }
  }

  const athleteFromPath = pagePath.match(new RegExp(`/athletes/(${UUID})`))?.[1] ?? null;
  const ctx: NavContext = {
    role,
    device,
    groupId,
    currentAthleteId: athleteFromPath && roster.some((r) => r.id === athleteFromPath) ? athleteFromPath : null,
    roster,
    clientPrograms,
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
  // "What did Johann say in that last chat?": show the last few messages as they were written, no AI. They are shown as plain text, never acted on.
  let preview: { clientName: string; messages: { fromClient: boolean; body: string; at: string }[] } | null = null;
  if (result.kind === "navigate" && result.intentIds[0] === "client-messages" && result.chips.length === 1) {
    const person = roster.find((r) => result.chips[0].href.includes(r.id));
    if (person) {
      try {
        const { data: rows } = await supabase
          .from("direct_messages")
          .select("sender_id, body, created_at")
          .eq("group_id", person.groupId ?? groupId)
          .or(`and(sender_id.eq.${user.id},recipient_id.eq.${person.id}),and(sender_id.eq.${person.id},recipient_id.eq.${user.id})`)
          .order("created_at", { ascending: false })
          .limit(5);
        const list = ((rows ?? []) as { sender_id: string; body: string; created_at: string }[])
          .reverse()
          .map((m) => ({ fromClient: m.sender_id === person.id, body: String(m.body).slice(0, 400), at: m.created_at }));
        if (list.length > 0) preview = { clientName: person.fullName, messages: list };
      } catch {
        // No preview; the button to the full chat is still there.
      }
    }
  }
  return NextResponse.json({ kind: result.kind, text: result.text, chips: result.chips, confirm: result.kind === "navigate" ? result.confirm ?? null : null, preview });
}
