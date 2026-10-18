import { generateClaimToken, hashClaimToken } from "@/lib/client-claim";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { maskEmail } from "@/lib/mask-email";

// A person's sign-in email is theirs. When a coach asks to change it for a client who has already signed in, nothing changes until the owner of the NEW address confirms by a link emailed to it; the old
// address is told at once and can cancel. This keeps a coach from pointing a client's login at an inbox they can read and then using "Forgot password". The link is a random token (only its hash is stored),
// lasts EMAIL_CHANGE_HOURS, works once, and is confirmed by a button on a page (never by simply opening the link, which an email scanner does), so it can't be used up by a preview.
export const EMAIL_CHANGE_HOURS = 48;

export type ChangeResult =
  | { ok: true; email: string; profileId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "cancelled" | "taken" | "failed" };

const lookup = async (db: any, token: string) => {
  const { data } = await db.from("pending_email_changes").select("id, profile_id, new_email, old_email, group_id, expires_at, confirmed_at, cancelled_at").eq("token_hash", hashClaimToken(token)).maybeSingle();
  return data as { id: string; profile_id: string; new_email: string; old_email: string | null; group_id: string | null; expires_at: string; confirmed_at: string | null; cancelled_at: string | null } | null;
};

// Records the request (replacing an earlier waiting one for the same person) and returns the two links. Nothing about the account changes.
export async function requestEmailChange(
  db: any,
  args: { profileId: string; newEmail: string; oldEmail: string | null; requestedBy: string; groupId: string | null; origin: string }
): Promise<{ ok: true; confirmLink: string; cancelLink: string } | { ok: false }> {
  const token = generateClaimToken();
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_HOURS * 3600_000).toISOString();
  const { data: made, error } = await db
    .from("pending_email_changes")
    .insert({ profile_id: args.profileId, new_email: args.newEmail.toLowerCase(), old_email: args.oldEmail, token_hash: hashClaimToken(token), requested_by: args.requestedBy, group_id: args.groupId, expires_at: expiresAt })
    .select("id")
    .single();
  if (error || !made) return { ok: false };
  // The new request is made first; earlier waiting ones are cancelled only once it exists.
  await db.from("pending_email_changes").update({ cancelled_at: new Date().toISOString() }).eq("profile_id", args.profileId).is("confirmed_at", null).is("cancelled_at", null).neq("id", made.id);
  return { ok: true, confirmLink: `${args.origin}/email-change?action=confirm&token=${token}`, cancelLink: `${args.origin}/email-change?action=cancel&token=${token}` };
}

// What the page needs to describe a link before the button is pressed (never the whole address).
export async function describeEmailChange(db: any, token: string): Promise<{ state: "waiting" | "expired" | "used" | "cancelled" | "unknown"; newEmail?: string }> {
  const row = await lookup(db, token);
  if (!row) return { state: "unknown" };
  if (row.confirmed_at) return { state: "used" };
  if (row.cancelled_at) return { state: "cancelled" };
  if (new Date(row.expires_at) <= new Date()) return { state: "expired" };
  return { state: "waiting", newEmail: maskEmail(row.new_email) };
}

// The owner of the new address pressed Confirm. The request is claimed first (so a second press does nothing), then the login is changed; if that fails the claim is given back.
export async function confirmEmailChange(db: any, token: string): Promise<ChangeResult> {
  const row = await lookup(db, token);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.confirmed_at) return { ok: false, reason: "used" };
  if (row.cancelled_at) return { ok: false, reason: "cancelled" };
  if (new Date(row.expires_at) <= new Date()) return { ok: false, reason: "expired" };
  const { data: claimed } = await db
    .from("pending_email_changes")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("confirmed_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");
  if ((claimed ?? []).length === 0) return { ok: false, reason: "used" };

  const { error } = await db.auth.admin.updateUserById(row.profile_id, { email: row.new_email, email_confirm: true });
  if (error) {
    await db.from("pending_email_changes").update({ confirmed_at: null }).eq("id", row.id);
    return { ok: false, reason: /already|registered|exists|duplicate/i.test(error.message) ? "taken" : "failed" };
  }
  // The client is told in the app; a recent change also pauses sign-in links being sent to a brand-new inbox (lib/resend-access.ts).
  await db.from("notifications").insert({ profile_id: row.profile_id, group_id: row.group_id, type: "email_changed", body: `Your sign-in email is now ${row.new_email}.`, link_path: row.group_id ? `/groups/${row.group_id}` : "/" });
  if (row.old_email && !isPlaceholderEmail(row.old_email) && isEmailConfigured()) {
    await sendEmail(row.old_email, "Your sign-in email was changed", `The sign-in email on your Spotlight Coaching account is now ${maskEmail(row.new_email)}, confirmed from that address. If this was not you, contact your coach right away.`).catch(() => false);
  }
  return { ok: true, email: row.new_email, profileId: row.profile_id };
}

// The old address (or anyone holding the link) says no: nothing is changed, and the client is told in the app.
export async function cancelEmailChange(db: any, token: string): Promise<{ ok: boolean }> {
  const row = await lookup(db, token);
  if (!row || row.confirmed_at) return { ok: false };
  if (row.cancelled_at) return { ok: true };
  const { error } = await db.from("pending_email_changes").update({ cancelled_at: new Date().toISOString() }).eq("id", row.id).is("confirmed_at", null);
  if (error) return { ok: false };
  await db.from("notifications").insert({ profile_id: row.profile_id, group_id: row.group_id, type: "email_change_cancelled", body: "A change to your sign-in email was cancelled. Nothing changed.", link_path: row.group_id ? `/groups/${row.group_id}` : "/" });
  return { ok: true };
}

// The two emails sent when a change is asked for.
export async function sendEmailChangeMessages(args: { coachName: string | null; newEmail: string; oldEmail: string | null; confirmLink: string; cancelLink: string }): Promise<{ toNew: boolean; toOld: boolean }> {
  const who = args.coachName ?? "Your coach";
  const toNew = await sendEmail(
    args.newEmail,
    "Confirm your new sign-in email",
    `${who} asked to change the sign-in email on a Spotlight Coaching account to this address.\n\nIf that is you, confirm it here (the link works for ${EMAIL_CHANGE_HOURS} hours):\n${args.confirmLink}\n\nNothing changes until you press Confirm on that page. If this is not you, ignore this message.`
  ).catch(() => false);
  let toOld = false;
  if (args.oldEmail && !isPlaceholderEmail(args.oldEmail)) {
    toOld = await sendEmail(
      args.oldEmail,
      "A change to your sign-in email was asked for",
      `${who} asked to change your sign-in email to ${maskEmail(args.newEmail)}. Nothing has changed yet: it changes only if the owner of that address confirms it.\n\nIf you did not expect this, cancel it here:\n${args.cancelLink}\n\nand tell your coach.`
    ).catch(() => false);
  }
  return { toNew, toOld };
}
