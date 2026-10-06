// Deleting a person's account for good. Used by a client deleting themselves (Settings) and by a coach deleting a client.
//
// What is erased: the account, profile and everything that is the person's own (posts, messages, check-ins, habits, photos,
// weight, goals, intake and waiver records, push subscriptions, wearable links, session balances and subscription rows).
// What is kept, no longer linked to any person: payment records (credit_purchases are financial records), and, unless the coach
// chooses to erase them too, logged workouts and the coach's notes. The audit log is append-only and keeps ids and field names
// only. A client with a live subscription cannot be deleted until it is cancelled, so no one is billed for an account that is gone.

// Records that are really the COACH's, kept with the person detached. Billing is always kept.
const ALWAYS_DETACH = ["credit_purchases"] as const;
// Kept by default, erased when the coach asks for a complete delete.
const HISTORY_TABLES = ["workout_logs", "athlete_sessions", "athlete_notes"] as const;

// Columns that point at the person as the AUTHOR of a row. A not-null column blocks deleting the account, so those rows (the
// person's own goals, check-ins and the like) are erased first; a nullable one is just emptied.
const AUTHOR_COLUMNS_ERASE: [string, string][] = [
  ["athlete_exercise_overrides", "created_by"],
  ["client_goals", "created_by"],
  ["client_habits", "created_by"],
  ["client_tags", "created_by"],
  ["daily_macros", "created_by"],
  ["exercise_progressions", "created_by"],
  ["meal_plans", "created_by"],
  ["nutrition_checkins", "created_by"],
  ["nutrition_phases", "created_by"],
  ["workout_assignments", "created_by"],
  ["workout_notes", "created_by"],
  ["guardian_links", "created_by"],
];
const AUTHOR_COLUMNS_CLEAR: [string, string][] = [
  ["athlete_injury_status", "marked_by"],
  ["client_goals", "confirmed_by"],
  ["client_macro_target_history", "created_by"],
  ["client_macro_targets", "updated_by"],
  ["minor_consent", "verified_by"],
];

export interface DeletionFacts {
  isPlatformAdmin: boolean;
  coachGroupCount: number;
  orgMembershipCount: number;
  createdGroupCount: number;
  liveSubscriptionCount: number;
}

// Why this account cannot be deleted here, or null. Coaches, organization members and anyone who created a group own data that
// other people depend on, so they are never removed this way.
export function deletionBlocker(f: DeletionFacts): string | null {
  if (f.isPlatformAdmin) return "This account is a platform administrator and can't be deleted here.";
  if (f.coachGroupCount > 0 || f.orgMembershipCount > 0 || f.createdGroupCount > 0) {
    return "This account coaches or owns groups, so it can't be deleted here. Only a plain client account can.";
  }
  if (f.liveSubscriptionCount > 0) return "They have a live subscription. Cancel it first so they are not billed for a deleted account.";
  return null;
}

export async function loadDeletionFacts(db: any, userId: string): Promise<DeletionFacts> {
  const [profile, coach, orgs, created, subs] = await Promise.all([
    db.from("profiles").select("is_platform_admin").eq("id", userId).maybeSingle(),
    db.from("group_memberships").select("group_id", { count: "exact", head: true }).eq("profile_id", userId).eq("role", "coach"),
    db.from("organization_memberships").select("organization_id", { count: "exact", head: true }).eq("profile_id", userId),
    db.from("groups").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("membership_subscriptions").select("athlete_id", { count: "exact", head: true }).eq("athlete_id", userId).in("status", ["active", "past_due", "incomplete"]),
  ]);
  return {
    isPlatformAdmin: profile.data?.is_platform_admin === true,
    coachGroupCount: coach.count ?? 0,
    orgMembershipCount: orgs.count ?? 0,
    createdGroupCount: created.count ?? 0,
    liveSubscriptionCount: subs.count ?? 0,
  };
}

export type EraseResult = { ok: true } | { ok: false; error: string };

// Does the deletion. Order matters: detach or erase what would block the delete, then the account itself, which removes the
// rest through the database's own cascades. Stops at the first failure and says so.
export async function eraseAccount(db: any, userId: string, opts: { eraseHistory: boolean; deleteEmptyOneOnOneGroups?: string[] }): Promise<EraseResult> {
  const fail = (what: string, message: string): EraseResult => ({ ok: false, error: `${what}: ${message}` });

  if (opts.eraseHistory) {
    for (const table of HISTORY_TABLES) {
      const { error } = await db.from(table).delete().eq("athlete_id", userId);
      if (error) return fail(`Couldn't erase ${table}`, error.message);
    }
  } else {
    for (const table of HISTORY_TABLES) {
      const { error } = await db.from(table).update({ athlete_id: null }).eq("athlete_id", userId);
      if (error) return fail("Couldn't keep the coach's records", error.message);
    }
  }
  for (const table of ALWAYS_DETACH) {
    const { error } = await db.from(table).update({ athlete_id: null }).eq("athlete_id", userId);
    if (error) return fail("Couldn't keep the payment records", error.message);
  }
  for (const [table, column] of AUTHOR_COLUMNS_ERASE) {
    const { error } = await db.from(table).delete().eq(column, userId);
    if (error) return fail(`Couldn't clear ${table}`, error.message);
  }
  for (const [table, column] of AUTHOR_COLUMNS_CLEAR) {
    const { error } = await db.from(table).update({ [column]: null }).eq(column, userId);
    if (error) return fail(`Couldn't clear ${table}`, error.message);
  }

  const { error: deleteError } = await db.auth.admin.deleteUser(userId);
  if (deleteError) return fail("Couldn't delete the account", deleteError.message);

  // A one-on-one space that held only this client has nothing left in it.
  for (const groupId of opts.deleteEmptyOneOnOneGroups ?? []) {
    await db.from("groups").delete().eq("id", groupId);
  }
  return { ok: true };
}
