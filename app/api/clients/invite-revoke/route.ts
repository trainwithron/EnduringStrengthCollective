import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadUnclaimedClient } from "@/lib/client-claim-server";

// Cancels the client's unused sign-in link. The link can't be shown again (only a
// hash of it is stored), so cancelling is how a coach recovers from a link sent
// to the wrong place; they create a fresh one afterwards.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, athleteId } = await request.json();
  if (!groupId || !athleteId) {
    return NextResponse.json({ error: "Missing groupId or athleteId." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();
  const client = await loadUnclaimedClient(supabase, serviceRole, user.id, groupId, athleteId);
  if (!client.ok) return NextResponse.json({ error: client.error }, { status: client.status });

  const now = new Date().toISOString();
  // used_at is what the claim route already rejects, so cancelling needs no new gate there.
  let { error } = await serviceRole
    .from("client_invites")
    .update({ used_at: now, revoked_at: now, revoked_by: user.id })
    .eq("athlete_id", athleteId)
    .is("used_at", null);
  if (error) {
    // revoked_* columns not there yet: fall back to retiring the link the way regenerate does.
    ({ error } = await serviceRole
      .from("client_invites")
      .update({ used_at: now })
      .eq("athlete_id", athleteId)
      .is("used_at", null));
  }
  if (error) return NextResponse.json({ error: "Couldn't cancel the link. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
