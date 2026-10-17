import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createUnclaimedClient } from "@/lib/create-unclaimed-client";
import { clientLimitMessage } from "@/lib/free-tier-clients";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { rateLimitResponse } from "@/lib/rate-limit";
import { parseRoster, ROSTER_MAX_ROWS } from "@/lib/roster-import";
import { runPool } from "@/lib/run-pool";

// Adding a whole roster at once: the same silent account for each person as adding one client (nothing is emailed or texted; see /api/clients/invite), into a team or social group. Each person is
// reported on their own: added, or not added and why. One person failing never stops the rest.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = await request.json().catch(() => null);
  const body: { groupId?: unknown; people?: unknown } = raw && typeof raw === "object" ? raw : {};
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const people: { name?: unknown; email?: unknown }[] = Array.isArray(body.people) ? body.people.filter((p): p is { name?: unknown; email?: unknown } => !!p && typeof p === "object") : [];
  if (!groupId || people.length === 0) return NextResponse.json({ error: "Missing the group or the people to add." }, { status: 400 });
  if (people.length > ROSTER_MAX_ROWS) return NextResponse.json({ error: `Only ${ROSTER_MAX_ROWS} people can be added at a time.` }, { status: 400 });

  // The caller must coach this group (checked as the caller, so row security decides).
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ error: "Only coaches can add clients." }, { status: 403 });

  // Each person made is an account, and a coach who types emails can tell which already have one: a few whole rosters an hour is real use, more is probing.
  const limited = await rateLimitResponse("client-roster-import", user.id, 10, 3600);
  if (limited) return limited;

  const serviceRole = createServiceRoleClient();
  const { data: group } = await serviceRole.from("groups").select("group_kind, name").eq("id", groupId).maybeSingle();
  if (!group) return NextResponse.json({ error: "That group wasn't found." }, { status: 404 });
  if (group.group_kind === "one_on_one") return NextResponse.json({ error: `"${group.name}" is a 1-on-1 space and holds one client. Add a roster to a team or a group.` }, { status: 409 });

  // The page already checked these; checked again here because the page is not the only way to call this.
  const checked = parseRoster(
    people.map((p) => [typeof p.name === "string" ? p.name : "", typeof p.email === "string" ? p.email : ""]),
    { noHeader: true }
  );
  const results: { rowNumber: number; name: string; ok: boolean; profileId?: string; reason?: string }[] = checked.skipped.map((s) => ({ rowNumber: s.rowNumber, name: "", ok: false, reason: s.detail }));

  // On the free plan only so many people fit: count the room once, make accounts for those who fit, and report the rest as not added (never make an account and take it back).
  const { data: headroomRaw } = await serviceRole.rpc("free_tier_client_headroom", { p_group: groupId });
  const headroom = typeof headroomRaw === "number" ? headroomRaw : null;
  const fits = headroom == null ? checked.rows : checked.rows.slice(0, headroom);
  for (const row of headroom == null ? [] : checked.rows.slice(headroom)) results.push({ rowNumber: row.rowNumber, name: row.name, ok: false, reason: clientLimitMessage() });

  const pool = await runPool(fits, 4, async (row) => {
    const made = await createUnclaimedClient(serviceRole, { groupId, fullName: row.name, email: row.email ?? "" });
    if (!made.ok) {
      results.push({ rowNumber: row.rowNumber, name: row.name, ok: false, reason: made.error });
      return;
    }
    results.push({ rowNumber: row.rowNumber, name: row.name, ok: true, profileId: made.profileId });
    await dispatchWebhookEvent(serviceRole, {
      coachId: user.id,
      eventType: "client_added",
      payload: { athleteId: made.profileId, fullName: row.name, email: row.email, groupId },
    }).catch(() => {
      // Deliberately ignored: the client is added; a Zapier hook that could not be told is not worth undoing them for.
    });
  });

  // A person whose creation threw (not just refused) is reported too, never silently missing.
  for (const f of pool.failed) results.push({ rowNumber: f.item.rowNumber, name: f.item.name, ok: false, reason: "Couldn't add this person. Try them again." });
  results.sort((a, b) => a.rowNumber - b.rowNumber);
  return NextResponse.json({ groupId, results, added: results.filter((r) => r.ok).length });
}
