import type { SupabaseClient } from "@supabase/supabase-js";

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
