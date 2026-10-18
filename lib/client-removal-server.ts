import { deletionBlocker, eraseAccount, loadDeletionFacts } from "@/lib/account-deletion";

// The scheduled part of "Delete permanently": a removal whose 30 days are up and that was not put back. It erases the account as the delete always did, but only when that is safe and right:
//   - the person still belongs to some other group, or another coach has an open removal of the same person (their "Remove from my clients" promised the account is kept): then only this removal stands and the account is kept, and the record says so;
//   - the account can't be deleted here (a platform administrator, someone who coaches or owns groups, a live subscription): the record says why and the job tries again in a week;
//   - otherwise the account is erased (logged workouts and the coach's notes too only if the coach chose that), and a one-on-one space that held only this client is dealt with the way the delete always did.
// The erase is built to be repeated safely. The record is marked "erasing" first (so Put back is refused while it is under way and two runs never overlap), a person-free note goes to client_removal_log BEFORE anything is
// erased (the record itself goes when the account does), and the account itself is deleted before the clean-up of a one-on-one space (so a failed delete leaves the person, their space and their record exactly as they were). A step that fails leaves the
// record marked, with the reason, and the next run finishes the job; a clean-up step that fails after the account is gone is written to the note.
// Each removal is its own step, so one that fails never stops the others.
export interface DueRemoval {
  id: string;
  group_id: string | null;
  athlete_id: string;
  erase_history: boolean;
}

export type PurgeOutcome = "erased" | "kept_other_groups" | "blocked" | "failed" | "skipped";

const HOUR = 3600000;
const WEEK = 7 * 86400000;

export async function purgeOneRemoval(db: any, r: DueRemoval, now: Date = new Date()): Promise<PurgeOutcome> {
  const note = async (text: string, extra: Record<string, unknown> = {}) => {
    await db.from("client_removals").update({ purge_note: text, ...extra }).eq("id", r.id);
  };
  const retryLater = { delete_after: new Date(now.getTime() + WEEK).toISOString() };
  const release = { erasing_since: null };

  // Claim it. A run that crashed an hour ago does not block this one; a Put back that got in first means there is nothing to do.
  const { data: claimed, error: claimError } = await db
    .from("client_removals")
    .update({ erasing_since: now.toISOString() })
    .eq("id", r.id)
    .is("restored_at", null)
    .is("purged_at", null)
    .or(`erasing_since.is.null,erasing_since.lt.${new Date(now.getTime() - HOUR).toISOString()}`)
    .select("id");
  if (claimError) return "failed";
  if (!claimed || claimed.length === 0) return "skipped";

  // Still in a group somewhere, or kept by another coach's removal? Then only this removal stands.
  const [stillInResult, otherOpenResult] = await Promise.all([
    db.from("group_memberships").select("group_id").eq("profile_id", r.athlete_id),
    db.from("client_removals").select("id").eq("athlete_id", r.athlete_id).neq("id", r.id).is("restored_at", null).is("purged_at", null),
  ]);
  if (stillInResult.error || otherOpenResult.error) {
    await note("Couldn't check where else they belong; will try again.", { ...retryLater, ...release });
    return "failed";
  }
  if ((stillInResult.data ?? []).length > 0) {
    await note("They belong to other groups, so only the removal stands; their account was kept.", { purged_at: now.toISOString(), ...release });
    return "kept_other_groups";
  }
  if ((otherOpenResult.data ?? []).length > 0) {
    await note("Another coach has also taken them out of their clients and kept their account, so only this removal stands; their account was kept.", { purged_at: now.toISOString(), ...release });
    return "kept_other_groups";
  }

  const blocker = deletionBlocker(await loadDeletionFacts(db, r.athlete_id));
  if (blocker) {
    await note(blocker + " Will try again in a week.", { ...retryLater, ...release });
    return "blocked";
  }

  // The space that held only this client (nobody else is in it now that they are out).
  const emptyOneOnOne: string[] = [];
  if (r.group_id) {
    const { data: space } = await db.from("groups").select("id, group_kind").eq("id", r.group_id).maybeSingle();
    if ((space as { group_kind?: string } | null)?.group_kind === "one_on_one") {
      const { count } = await db.from("group_memberships").select("profile_id", { count: "exact", head: true }).eq("group_id", r.group_id).eq("role", "athlete");
      if ((count ?? 0) === 0) emptyOneOnOne.push(r.group_id);
    }
  }

  // The note that outlives the person: written before anything is erased, finished afterwards. No name and no email.
  // One row per removal: a retry updates it rather than adding another.
  const writeLog = (outcome: string, text: string) =>
    db.from("client_removal_log").upsert({ removal_id: r.id, group_id: r.group_id, outcome, note: text }, { onConflict: "removal_id" });
  const { error: logError } = await writeLog("erasing", "The 30 days were up; the account is being erased.");
  if (logError) {
    await note("Couldn't write the note that is kept after the erase; will try again in a week.", { ...retryLater, ...release });
    return "failed";
  }

  const result = await eraseAccount(db, r.athlete_id, { eraseHistory: r.erase_history, deleteEmptyOneOnOneGroups: emptyOneOnOne });
  if (!result.ok) {
    // Left marked "erasing" (Put back is refused until the erase is finished) with the reason; the next run picks it up.
    await note(result.error + " Will try again in a week.", retryLater);
    await writeLog("failed", result.error + " Will try again in a week.");
    return "failed";
  }
  // The removal record went with the account (it is tied to the person); the log is what remains.
  await writeLog("erased", result.leftover ?? "The account was erased.");
  return "erased";
}

export async function purgeDueRemovals(
  db: any,
  now: Date = new Date()
): Promise<{ checked: number; erased: number; kept: number; blocked: number; failed: number; skipped: number; discarded: number }> {
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
  const tally = { checked: 0, erased: 0, kept: 0, blocked: 0, failed: 0, skipped: 0, discarded: 0 };
  for (const r of (due ?? []) as DueRemoval[]) {
    tally.checked++;
    try {
      const outcome = await purgeOneRemoval(db, r, now);
      if (outcome === "erased") tally.erased++;
      else if (outcome === "kept_other_groups") tally.kept++;
      else if (outcome === "blocked") tally.blocked++;
      else if (outcome === "skipped") tally.skipped++;
      else tally.failed++;
    } catch (e) {
      console.error("[purge removed clients]", r.id, e instanceof Error ? e.message : e);
      tally.failed++;
    }
  }
  tally.discarded = await discardOrphanedRemovals(db, now);
  return tally;
}

// A plain "Remove from my clients" whose group has since been deleted can never be put back and is no longer listed anywhere, yet still holds the person's name and email. After 30 days it is discarded, with a person-free note.
export async function discardOrphanedRemovals(db: any, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
  const { data, error } = await db
    .from("client_removals")
    .select("id")
    .is("group_id", null)
    .is("delete_after", null)
    .is("restored_at", null)
    .is("purged_at", null)
    .lte("removed_at", cutoff)
    .limit(200);
  if (error) return 0;
  let discarded = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    const { error: logError } = await db.from("client_removal_log").upsert({ removal_id: row.id, group_id: null, outcome: "record_discarded", note: "The group was deleted, so this removal could no longer be put back; its record was discarded after 30 days." }, { onConflict: "removal_id" });
    if (logError) continue;
    const { error: deleteError } = await db.from("client_removals").delete().eq("id", row.id);
    if (!deleteError) discarded++;
  }
  return discarded;
}
