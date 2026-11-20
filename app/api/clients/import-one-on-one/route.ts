import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createUnclaimedClient } from "@/lib/create-unclaimed-client";
import { createGroupWithCoach } from "@/lib/create-group";
import { clientLimitMessage } from "@/lib/free-tier-clients";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { rateLimitResponse } from "@/lib/rate-limit";
import { parseRoster, ROSTER_MAX_ROWS } from "@/lib/roster-import";
import { runPool } from "@/lib/run-pool";

// Pasting a list of one-on-one clients (Ron, Nov 20: "onboarding smoothness is a priority"; a coach moving in from another app adds everyone at once instead of one form at a time). Each person gets
// what adding one one-on-one client gives them: their own private space with this coach, and the same silent account (nothing is emailed or texted; see /api/clients/invite). Each person is reported on
// their own: added, or not added and why. One person failing never stops the rest, and a space made for someone who could not be added is taken back.
// Someone whose email already has an account is not made again: they are listed, to be added on their own (which sends them an invitation to accept).
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = await request.json().catch(() => null);
  const body: { groupId?: unknown; people?: unknown } = raw && typeof raw === "object" ? raw : {};
  // groupId: the space the coach is standing in, only to know which organization the new clients belong to.
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const people: { name?: unknown; email?: unknown }[] = Array.isArray(body.people) ? body.people.filter((p): p is { name?: unknown; email?: unknown } => !!p && typeof p === "object") : [];
  if (!groupId || people.length === 0) return NextResponse.json({ error: "Missing the organization or the people to add." }, { status: 400 });
  if (people.length > ROSTER_MAX_ROWS) return NextResponse.json({ error: `Only ${ROSTER_MAX_ROWS} people can be added at a time.` }, { status: 400 });

  // The caller must coach the space they are standing in (checked as the caller, so row security decides).
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ error: "Only coaches can add clients." }, { status: 403 });

  // The same budget as importing a roster into a group: a few whole lists an hour is real use, more is probing.
  const limited = await rateLimitResponse("client-roster-import", user.id, 10, 3600);
  if (limited) return limited;

  const serviceRole = createServiceRoleClient();
  const { data: here } = await serviceRole.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  const organizationId = (here as { organization_id?: string | null } | null)?.organization_id ?? null;
  if (!organizationId) return NextResponse.json({ error: "This space is not part of an organization, so one-on-one clients cannot be added from here. Open one of your organizations first." }, { status: 409 });
  const { data: orgSeat } = await supabase.from("organization_memberships").select("organization_id").eq("organization_id", organizationId).eq("profile_id", user.id).maybeSingle();
  if (!orgSeat) return NextResponse.json({ error: "Couldn't find your business. Try again." }, { status: 403 });

  // The page already checked these; checked again here because the page is not the only way to call this.
  const checked = parseRoster(
    people.map((p) => [typeof p.name === "string" ? p.name : "", typeof p.email === "string" ? p.email : ""]),
    { noHeader: true }
  );
  const results: { rowNumber: number; name: string; ok: boolean; profileId?: string; groupId?: string; reason?: string }[] = checked.skipped.map((s) => ({ rowNumber: s.rowNumber, name: "", ok: false, reason: s.detail }));

  // On the free plan only so many people fit: count the room once (the organization's count), make accounts for those who fit, and report the rest as not added.
  const { data: headroomRaw } = await serviceRole.rpc("free_tier_client_headroom", { p_group: groupId });
  const headroom = typeof headroomRaw === "number" ? headroomRaw : null;
  const fits = headroom == null ? checked.rows : checked.rows.slice(0, headroom);
  for (const row of headroom == null ? [] : checked.rows.slice(headroom)) results.push({ rowNumber: row.rowNumber, name: row.name, ok: false, reason: clientLimitMessage() });

  // A space made here and not used (the person could not be added) is removed again: the server may delete it, the signed-in coach may not.
  const discard = async (id: string) => {
    const { error } = await serviceRole.from("groups").delete().eq("id", id);
    return !error;
  };

  const pool = await runPool(fits, 3, async (row) => {
    if (row.email) {
      const { data: found } = await serviceRole.rpc("profile_id_for_email", { p_email: row.email });
      if (typeof found === "string" && found) {
        results.push({ rowNumber: row.rowNumber, name: row.name, ok: false, reason: "That email already has an account. Add them on their own to send them an invitation to accept." });
        return;
      }
    }
    const space = await createGroupWithCoach(supabase, { userId: user.id, name: row.name, organizationId, kind: "one_on_one", discard });
    if (!space.id) {
      results.push({ rowNumber: row.rowNumber, name: row.name, ok: false, reason: "Couldn't set up their space. Try them again." });
      return;
    }
    const made = await createUnclaimedClient(serviceRole, { groupId: space.id, fullName: row.name, email: row.email ?? "" });
    if (!made.ok) {
      // Only the coach's seat is in it: take the empty space back.
      await serviceRole.from("group_memberships").delete().eq("group_id", space.id).eq("profile_id", user.id);
      await discard(space.id);
      results.push({ rowNumber: row.rowNumber, name: row.name, ok: false, reason: made.error });
      return;
    }
    results.push({ rowNumber: row.rowNumber, name: row.name, ok: true, profileId: made.profileId, groupId: space.id });
    await dispatchWebhookEvent(serviceRole, {
      coachId: user.id,
      eventType: "client_added",
      payload: { athleteId: made.profileId, fullName: row.name, email: row.email, groupId: space.id },
    }).catch(() => {
      // Deliberately ignored: the client is added; a Zapier hook that could not be told is not worth undoing them for.
    });
  });

  // A person whose creation threw (not just refused) is reported too, never silently missing.
  for (const f of pool.failed) results.push({ rowNumber: f.item.rowNumber, name: f.item.name, ok: false, reason: "Couldn't add this person. Try them again." });
  results.sort((a, b) => a.rowNumber - b.rowNumber);
  return NextResponse.json({ results, added: results.filter((r) => r.ok).length });
}
