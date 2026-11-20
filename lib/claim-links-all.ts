import type { SupabaseClient } from "@supabase/supabase-js";
import { everSignedIn } from "@/lib/ever-signed-in";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { chunk } from "@/lib/chunk";
import { runPool } from "@/lib/run-pool";

// "Email sign-in links to everyone not signed in yet" (Ron, Nov 20: onboarding, O2). Who gets one: a client of this coach, in the organization the coach is working in, who has never signed in, has a real
// email address on their account, and has no sign-in link that still works (so each person is invited once, never chased: a person already sent a working link is skipped until it runs out).
// Never a team player or anyone with a parent on file (a guardian link or a minor's consent row): a young athlete who has not signed in has no birth date yet, so they cannot be told apart otherwise;
// their coach sends those one at a time. Every read that fails counts against sending (a person whose link could not be read is treated as already having one), never for it.
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

/** The same order every time (by name, then id), so the first 250 and the first 100 are always the same people. */
export function stableOrder<T extends { id: string; full_name: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => a.full_name.localeCompare(b.full_name) || a.id.localeCompare(b.id));
}

// The coach's clients who have never signed in, across the coach's non-team groups in this organization (each person once, with one of their groups). Read with the server's key after the route checked
// the caller coaches every one of these groups. `total` is how many unclaimed people there are before the 250 cut.
export async function loadClaimCandidates(
  serviceRole: SupabaseClient,
  coachId: string,
  groupIds: string[]
): Promise<{ candidates: ClaimCandidate[]; failed: boolean; total: number }> {
  let failed = false;
  // Team groups are left out (their players are often minors).
  const nonTeam: string[] = [];
  for (const ids of chunk(groupIds, 100)) {
    const { data, error } = await serviceRole.from("groups").select("id, team_mode").in("id", ids);
    if (error) failed = true;
    for (const g of (data ?? []) as { id: string; team_mode: boolean | null }[]) if (g.team_mode !== true) nonTeam.push(g.id);
  }
  const seen = new Map<string, string>(); // profile -> a group of theirs
  for (const ids of chunk(nonTeam, 100)) {
    const { data, error } = await serviceRole.from("group_memberships").select("profile_id, group_id").in("group_id", ids).eq("role", "athlete").limit(5000);
    if (error) failed = true;
    for (const m of (data ?? []) as { profile_id: string; group_id: string }[]) if (m.profile_id !== coachId && !seen.has(m.profile_id)) seen.set(m.profile_id, m.group_id);
  }
  const people = Array.from(seen.keys());
  // Anyone with a parent on file is never emailed in bulk (a failed read leaves everyone in that batch out).
  const withParent = new Set<string>();
  for (const ids of chunk(people, 100)) {
    const [links, consents] = await Promise.all([
      serviceRole.from("guardian_links").select("athlete_id").in("athlete_id", ids),
      serviceRole.from("minor_consent").select("athlete_id").in("athlete_id", ids),
    ]);
    if (links.error || consents.error) {
      failed = true;
      ids.forEach((id) => withParent.add(id));
      continue;
    }
    for (const r of [...(links.data ?? []), ...(consents.data ?? [])] as { athlete_id: string }[]) withParent.add(r.athlete_id);
  }
  // Only people never stamped as claimed are worth asking the sign-in service about.
  const unclaimed: { id: string; full_name: string }[] = [];
  for (const ids of chunk(people.filter((id) => !withParent.has(id)), 100)) {
    const { data, error } = await serviceRole.from("profiles").select("id, full_name, claimed_at").in("id", ids);
    if (error) failed = true;
    for (const p of (data ?? []) as { id: string; full_name: string | null; claimed_at: string | null }[]) if (!p.claimed_at) unclaimed.push({ id: p.id, full_name: p.full_name ?? "" });
  }
  const looked = stableOrder(unclaimed).slice(0, CLAIM_LINKS_ALL_MAX);
  // Who already has a link that still works: one read per hundred. A read that fails counts everyone in it as linked, so nobody is emailed (and their link replaced) on a guess.
  const linked = new Set<string>();
  const nowIso = new Date().toISOString();
  for (const ids of chunk(looked.map((p) => p.id), 100)) {
    const { data, error } = await serviceRole.from("client_invites").select("athlete_id").in("athlete_id", ids).is("used_at", null).gt("expires_at", nowIso);
    if (error) {
      failed = true;
      ids.forEach((id) => linked.add(id));
      continue;
    }
    for (const r of (data ?? []) as { athlete_id: string }[]) linked.add(r.athlete_id);
  }
  const candidates: ClaimCandidate[] = [];
  const pool = await runPool(looked, 8, async (p) => {
    const { data: auth, error } = await serviceRole.auth.admin.getUserById(p.id);
    if (error) throw error;
    candidates.push({
      profileId: p.id,
      groupId: seen.get(p.id)!,
      fullName: p.full_name,
      claimedAt: null,
      email: auth?.user?.email ?? null,
      lastSignInAt: auth?.user?.last_sign_in_at ?? null,
      hasLiveLink: linked.has(p.id),
    });
  });
  if (pool.failed.length > 0) failed = true;
  // back in the stable order (the pool finishes in any order)
  const rank = new Map(looked.map((p, i) => [p.id, i]));
  candidates.sort((a, b) => (rank.get(a.profileId) ?? 0) - (rank.get(b.profileId) ?? 0));
  return { candidates, failed, total: unclaimed.length };
}
