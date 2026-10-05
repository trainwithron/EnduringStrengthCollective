import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadUnclaimedClient } from "@/lib/client-claim-server";
import { CLAIM_LINK_LIFETIME_HOURS, generateClaimToken, hashClaimToken } from "@/lib/client-claim";

// Mints a single-use claim link for a client who hasn't signed in yet. The
// coach decides when to create it and sends it themselves (a text from their
// own phone, or copy/paste) — nothing is sent from here. Only the hash of
// the token is stored; creating a new link retires any earlier unused one.
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

  // Retire earlier unused links so only the newest one works.
  const retiredAt = new Date().toISOString();
  const { error: retireError } = await serviceRole
    .from("client_invites")
    .update({ used_at: retiredAt, revoked_at: retiredAt, revoked_by: user.id })
    .eq("athlete_id", athleteId)
    .is("used_at", null);
  if (retireError) {
    // revoked_* columns not there yet: retire the old link the way this always worked.
    await serviceRole
      .from("client_invites")
      .update({ used_at: retiredAt })
      .eq("athlete_id", athleteId)
      .is("used_at", null);
  }

  const token = generateClaimToken();
  const expiresAt = new Date(Date.now() + CLAIM_LINK_LIFETIME_HOURS * 60 * 60 * 1000).toISOString();
  const { error } = await serviceRole.from("client_invites").insert({
    athlete_id: athleteId,
    token_hash: hashClaimToken(token),
    created_by: user.id,
    expires_at: expiresAt,
  });
  if (error) return NextResponse.json({ error: "Couldn't create the link — try again." }, { status: 500 });

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  return NextResponse.json({
    link: `${origin}/claim/${token}`,
    expiresAt,
    clientName: client.fullName,
  });
}
