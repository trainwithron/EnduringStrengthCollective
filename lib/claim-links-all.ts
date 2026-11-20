import type { SupabaseClient } from "@supabase/supabase-js";
import { everSignedIn } from "@/lib/ever-signed-in";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { chunk } from "@/lib/chunk";

// "Email sign-in links to everyone not signed in yet" (Ron, Nov 20: onboarding, O2). Who gets one: a client of this coach, in the organization the coach is working in, who has never signed in, has a real
// email address on their account, and has no sign-in link that still works (so each person is invited once, never chased: a person already sent a working link is skipped until it runs out).
// Pure sorting here; the route reads the facts and sends.

export const CLAIM_LINKS_ALL_MAX = 250; // people looked at in one go (a batch import is up to 250)
export const CLAIM_LINKS_ALL_PER_SEND = 100; // emails sent in one press (the rest on the next press)

export interface ClaimCandidate {
  profileId: string;
  groupId: string;
  fullName: string;
  claimedAt: string | null;
  email: string | null;
  lastSignInAt: string | null;
  hasLiveLink: boolean;
}

export interface ClaimSort {
  eligible: ClaimCandidate[];
  noEmail: ClaimCandidate[];
  alreadyLinked: ClaimCandidate[];
}

export function sortClaimCandidates(candidates: ClaimCandidate[]): ClaimSort {
  const out: ClaimSort = { eligible: [], noEmail: [], alreadyLinked: [] };
  for (const c of candidates) {
    if (everSignedIn({ claimedAt: c.claimedAt, lastSignInAt: c.lastSignInAt, email: c.email })) continue;
    if (!c.email || isPlaceholderEmail(c.email)) out.noEmail.push(c);
    else if (c.hasLiveLink) out.alreadyLinked.push(c);
    else out.eligible.push(c);
  }
  return out;
}

// The coach's clients who have never signed in, across the coach's groups in this organization (each person once, with one of their groups). Read with the server's key after the route checked the caller
// coaches every one of these groups.
export async function loadClaimCandidates(serviceRole: SupabaseClient, coachId: string, groupIds: string[]): Promise<{ candidates: ClaimCandidate[]; failed: boolean }> {
  const seen = new Map<string, string>(); // profile -> a group of theirs
  let failed = false;
  for (const ids of chunk(groupIds, 100)) {
    const { data, error } = await serviceRole.from("group_memberships").select("profile_id, group_id").in("group_id", ids).eq("role", "athlete").limit(5000);
    if (error) failed = true;
    for (const m of (data ?? []) as { profile_id: string; group_id: string }[]) if (m.profile_id !== coachId && !seen.has(m.profile_id)) seen.set(m.profile_id, m.group_id);
  }
  // Only people never stamped as claimed are worth asking the sign-in service about.
  const unclaimed: { id: string; full_name: string }[] = [];
  for (const ids of chunk(Array.from(seen.keys()), 100)) {
    const { data, error } = await serviceRole.from("profiles").select("id, full_name, claimed_at").in("id", ids);
    if (error) failed = true;
    for (const p of (data ?? []) as { id: string; full_name: string | null; claimed_at: string | null }[]) if (!p.claimed_at) unclaimed.push({ id: p.id, full_name: p.full_name ?? "" });
  }
  const candidates: ClaimCandidate[] = [];
  for (const p of unclaimed.slice(0, CLAIM_LINKS_ALL_MAX)) {
    const { data: auth } = await serviceRole.auth.admin.getUserById(p.id);
    const { data: live } = await serviceRole.from("client_invites").select("id").eq("athlete_id", p.id).is("used_at", null).gt("expires_at", new Date().toISOString()).limit(1);
    candidates.push({
      profileId: p.id,
      groupId: seen.get(p.id)!,
      fullName: p.full_name,
      claimedAt: null,
      email: auth?.user?.email ?? null,
      lastSignInAt: auth?.user?.last_sign_in_at ?? null,
      hasLiveLink: (live ?? []).length > 0,
    });
  }
  return { candidates, failed };
}
