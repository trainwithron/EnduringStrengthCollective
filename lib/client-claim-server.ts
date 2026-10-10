import type { SupabaseClient } from "@supabase/supabase-js";
import { CLAIM_LINK_LIFETIME_HOURS, generateClaimToken, hashClaimToken } from "@/lib/client-claim";

// Shared guard for the coach-side claim routes: the caller must coach the
// group, the athlete must be an athlete member of it, and the account must
// not have been claimed yet (once the client has signed in it is THEIR
// account — the coach can no longer mint links or change its email).
export async function loadUnclaimedClient(
  supabase: SupabaseClient,
  serviceRole: SupabaseClient,
  userId: string,
  groupId: string,
  athleteId: string
): Promise<
  | { ok: true; fullName: string }
  | { ok: false; status: number; error: string }
> {
  const { data: caller } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", userId)
    .maybeSingle();
  if (caller?.role !== "coach") return { ok: false, status: 403, error: "Only this client's coach can do that." };

  const { data: member } = await serviceRole
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", athleteId)
    .maybeSingle();
  if (member?.role !== "athlete") return { ok: false, status: 404, error: "Client not found in this group." };

  const { data: profile } = await serviceRole
    .from("profiles")
    .select("full_name, claimed_at")
    .eq("id", athleteId)
    .maybeSingle();
  if (!profile) return { ok: false, status: 404, error: "Client not found." };
  if (profile.claimed_at) {
    return { ok: false, status: 409, error: "They've already signed in — this is their account now." };
  }
  return { ok: true, fullName: profile.full_name };
}

// Makes a fresh single-use claim link for a client and retires any earlier unused one, so only the newest works.
// Only the hash of the token is stored. Used by the "make a link" and the "email the link" routes.
export async function mintClaimLink(
  serviceRole: SupabaseClient,
  coachId: string,
  athleteId: string,
  origin: string
): Promise<{ ok: true; link: string; expiresAt: string } | { ok: false }> {
  const retiredAt = new Date().toISOString();
  const { error: retireError } = await serviceRole
    .from("client_invites")
    .update({ used_at: retiredAt, revoked_at: retiredAt, revoked_by: coachId })
    .eq("athlete_id", athleteId)
    .is("used_at", null);
  if (retireError) {
    // revoked_* columns not there yet: retire the old link the way this always worked.
    await serviceRole.from("client_invites").update({ used_at: retiredAt }).eq("athlete_id", athleteId).is("used_at", null);
  }

  const token = generateClaimToken();
  const expiresAt = new Date(Date.now() + CLAIM_LINK_LIFETIME_HOURS * 60 * 60 * 1000).toISOString();
  const { error } = await serviceRole.from("client_invites").insert({
    athlete_id: athleteId,
    token_hash: hashClaimToken(token),
    created_by: coachId,
    expires_at: expiresAt,
  });
  if (error) return { ok: false };
  return { ok: true, link: `${origin}/claim/${token}`, expiresAt };
}

// True when the client has a link that still works (so replacing it should be confirmed first).
export async function hasLiveClaimLink(serviceRole: SupabaseClient, athleteId: string): Promise<boolean> {
  const { data } = await serviceRole
    .from("client_invites")
    .select("id")
    .eq("athlete_id", athleteId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  return (data ?? []).length > 0;
}
