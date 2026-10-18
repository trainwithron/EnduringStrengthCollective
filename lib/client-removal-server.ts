import { deletionBlocker, eraseAccount, loadDeletionFacts } from "@/lib/account-deletion";

// The scheduled part of "Delete permanently": a removal whose 30 days are up and that was not put back. It erases the account as the delete always did, but only when that is safe and right:
//   - the person still belongs to some other group (another coach's, or another of this coach's): then only the removal stands and the account is kept, and the record says so;
//   - the account can't be deleted here (a platform administrator, someone who coaches or owns groups, a live subscription): the record says why and the job tries again in a week;
//   - otherwise the account is erased (logged workouts and the coach's notes too only if the coach chose that), and a one-on-one space that held only this client is dealt with the way the delete always did.
// Each removal is its own step, so one that fails never stops the others.
export interface DueRemoval {
  id: string;
  group_id: string;
  athlete_id: string;
  erase_history: boolean;
}

export type PurgeOutcome = "erased" | "kept_other_groups" | "blocked" | "failed";

export async function purgeOneRemoval(db: any, r: DueRemoval, now: Date = new Date()): Promise<PurgeOutcome> {
  const note = async (text: string, extra: Record<string, unknown> = {}) => {
    await db.from("client_removals").update({ purge_note: text, ...extra }).eq("id", r.id);
  };

  // Still in a group somewhere? Then only the removal stands.
  const { data: stillIn, error: stillError } = await db.from("group_memberships").select("group_id, groups ( group_kind )").eq("profile_id", r.athlete_id);
  if (stillError) {
    await note("Couldn't check their other groups; will try again.", { delete_after: new Date(now.getTime() + 7 * 86400000).toISOString() });
    return "failed";
  }
  if ((stillIn ?? []).length > 0) {
    await note("They belong to other groups, so only the removal stands; their account was kept.", { purged_at: now.toISOString() });
    return "kept_other_groups";
  }

  const blocker = deletionBlocker(await loadDeletionFacts(db, r.athlete_id));
  if (blocker) {
    await note(blocker + " Will try again in a week.", { delete_after: new Date(now.getTime() + 7 * 86400000).toISOString() });
    return "blocked";
  }

  // The space that held only this client (nobody else is in it now that they are out).
  const { data: space } = await db.from("groups").select("id, group_kind").eq("id", r.group_id).maybeSingle();
  const emptyOneOnOne: string[] = [];
  if ((space as { group_kind?: string } | null)?.group_kind === "one_on_one") {
    const { count } = await db.from("group_memberships").select("profile_id", { count: "exact", head: true }).eq("group_id", r.group_id).eq("role", "athlete");
    if ((count ?? 0) === 0) emptyOneOnOne.push(r.group_id);
  }

  const result = await eraseAccount(db, r.athlete_id, { eraseHistory: r.erase_history, deleteEmptyOneOnOneGroups: emptyOneOnOne });
  if (!result.ok) {
    await note(result.error + " Will try again in a week.", { delete_after: new Date(now.getTime() + 7 * 86400000).toISOString() });
    return "failed";
  }
  // The removal row goes with the account (it is tied to the person); nothing is left to update.
  return "erased";
}

export async function purgeDueRemovals(db: any, now: Date = new Date()): Promise<{ checked: number; erased: number; kept: number; blocked: number; failed: number }> {
  const { data: due, error } = await db
    .from("client_removals")
    .select("id, group_id, athlete_id, erase_history")
    .is("restored_at", null)
    .is("purged_at", null)
    .not("delete_after", "is", null)
    .lte("delete_after", now.toISOString())
    .order("delete_after", { ascending: true })
    .limit(200);
  if (error) throw new Error("Couldn't read the removals that are due.");
  const tally = { checked: 0, erased: 0, kept: 0, blocked: 0, failed: 0 };
  for (const r of (due ?? []) as DueRemoval[]) {
    tally.checked++;
    try {
      const outcome = await purgeOneRemoval(db, r, now);
      if (outcome === "erased") tally.erased++;
      else if (outcome === "kept_other_groups") tally.kept++;
      else if (outcome === "blocked") tally.blocked++;
      else tally.failed++;
    } catch (e) {
      console.error("[purge removed clients]", r.id, e instanceof Error ? e.message : e);
      tally.failed++;
    }
  }
  return tally;
}
