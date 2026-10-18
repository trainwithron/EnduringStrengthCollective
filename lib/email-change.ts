import { generateClaimToken, hashClaimToken } from "@/lib/client-claim";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { maskEmail } from "@/lib/mask-email";

// A person's sign-in email is theirs. When a coach asks to change it for a client who has already signed in, nothing changes until the owner of the NEW address confirms by a link emailed to it; the old
// address is told at once and can cancel with its own, different link. This keeps a coach from pointing a client's login at an inbox they can read and then using "Forgot password".
//   * Each link has its own random token (only the hashes are stored). The confirm token cannot cancel and the cancel token cannot confirm.
//   * For an account that has signed in and has a real old email, the earliest a change can be confirmed is EMAIL_CHANGE_DELAY_HOURS after it was asked for, so the old address and the in-app banner always get
//     a day to be seen: Cancel is a real brake even if the coach typed an inbox they control. An account with no real old email (never signed in, placeholder) can confirm at once.
//   * The request then stays open EMAIL_CHANGE_HOURS after it first can be confirmed, works once, and is confirmed by a button on a page (never by simply opening the link, which an email scanner does).
//   * At confirmation the world is checked again: the login must still be the address it was when asked, the coach must still coach the client, and this must still be the newest request.
export const EMAIL_CHANGE_HOURS = 48;
export const EMAIL_CHANGE_DELAY_HOURS = 24;

export type ChangeResult =
  | { ok: true; email: string; profileId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "cancelled" | "taken" | "failed" | "too_soon" | "stale"; availableAt?: string };

interface Row {
  id: string;
  profile_id: string;
  new_email: string;
  old_email: string | null;
  group_id: string | null;
  requested_by: string | null;
  confirmable_at: string;
  expires_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

const COLUMNS = "id, profile_id, new_email, old_email, group_id, requested_by, confirmable_at, expires_at, confirmed_at, cancelled_at, created_at";

// The confirm token finds a request by token_hash, the cancel token by cancel_token_hash: a token from one email can never do the job of the other.
const lookup = async (db: any, token: string, by: "confirm" | "cancel" = "confirm"): Promise<Row | null> => {
  const { data } = await db.from("pending_email_changes").select(COLUMNS).eq(by === "confirm" ? "token_hash" : "cancel_token_hash", hashClaimToken(token)).maybeSingle();
  return (data as Row | null) ?? null;
};

// Records the request and returns the two links. Nothing about the account changes, and an earlier waiting request is NOT touched yet (see supersedeOlder).
export async function requestEmailChange(
  db: any,
  args: { profileId: string; newEmail: string; oldEmail: string | null; requestedBy: string; groupId: string | null; origin: string; hasSignedIn: boolean; now?: Date }
): Promise<{ ok: true; id: string; confirmLink: string; cancelLink: string; confirmableAt: string } | { ok: false }> {
  const now = args.now ?? new Date();
  const token = generateClaimToken();
  const cancelToken = generateClaimToken();
  const realOld = !!args.oldEmail && !isPlaceholderEmail(args.oldEmail);
  const confirmableAt = new Date(now.getTime() + (args.hasSignedIn && realOld ? EMAIL_CHANGE_DELAY_HOURS * 3600_000 : 0)).toISOString();
  const expiresAt = new Date(new Date(confirmableAt).getTime() + EMAIL_CHANGE_HOURS * 3600_000).toISOString();
  const { data: made, error } = await db
    .from("pending_email_changes")
    .insert({
      profile_id: args.profileId,
      new_email: args.newEmail.toLowerCase(),
      old_email: args.oldEmail,
      token_hash: hashClaimToken(token),
      cancel_token_hash: hashClaimToken(cancelToken),
      requested_by: args.requestedBy,
      group_id: args.groupId,
      confirmable_at: confirmableAt,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !made) return { ok: false };
  return {
    ok: true,
    id: made.id,
    confirmLink: `${args.origin}/email-change?action=confirm&token=${token}`,
    cancelLink: `${args.origin}/email-change?action=cancel&token=${cancelToken}`,
    confirmableAt,
  };
}

// Once the confirmation email has really gone out, the person's EARLIER waiting requests are cancelled (a newer request replaces an older one). Done after sending, so a failed send never leaves them with nothing.
export async function supersedeOlder(db: any, profileId: string, keepId: string): Promise<void> {
  await db.from("pending_email_changes").update({ cancelled_at: new Date().toISOString() }).eq("profile_id", profileId).is("confirmed_at", null).is("cancelled_at", null).neq("id", keepId);
}

// A request whose email could not be sent is closed, so it cannot be confirmed by a link nobody received.
export async function abandonRequest(db: any, id: string): Promise<void> {
  await db.from("pending_email_changes").update({ cancelled_at: new Date().toISOString() }).eq("id", id).is("confirmed_at", null);
}

// What the page needs to describe a link before the button is pressed (never the whole address).
export async function describeEmailChange(
  db: any,
  token: string,
  by: "confirm" | "cancel" = "confirm",
  now: Date = new Date()
): Promise<{ state: "waiting" | "expired" | "used" | "cancelled" | "unknown"; newEmail?: string; hoursUntilConfirmable?: number }> {
  const row = await lookup(db, token, by);
  if (!row) return { state: "unknown" };
  if (row.confirmed_at) return { state: "used" };
  if (row.cancelled_at) return { state: "cancelled" };
  if (new Date(row.expires_at) <= now) return { state: "expired" };
  const wait = new Date(row.confirmable_at).getTime() - now.getTime();
  return { state: "waiting", newEmail: maskEmail(row.new_email), ...(by === "confirm" && wait > 0 ? { hoursUntilConfirmable: Math.ceil(wait / 3600_000) } : {}) };
}

// The owner of the new address pressed Confirm. The request is claimed first (so a second press does nothing), the world is checked again, then the login is changed; whatever goes wrong, the claim is given back.
export async function confirmEmailChange(db: any, token: string, now: Date = new Date()): Promise<ChangeResult> {
  const row = await lookup(db, token, "confirm");
  if (!row) return { ok: false, reason: "invalid" };
  if (row.confirmed_at) return { ok: false, reason: "used" };
  if (row.cancelled_at) return { ok: false, reason: "cancelled" };
  if (new Date(row.expires_at) <= now) return { ok: false, reason: "expired" };
  if (new Date(row.confirmable_at) > now) return { ok: false, reason: "too_soon", availableAt: row.confirmable_at };

  const { data: claimed } = await db
    .from("pending_email_changes")
    .update({ confirmed_at: now.toISOString() })
    .eq("id", row.id)
    .is("confirmed_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", now.toISOString())
    .select("id");
  if ((claimed ?? []).length === 0) return { ok: false, reason: "used" };

  const giveBack = () => db.from("pending_email_changes").update({ confirmed_at: null }).eq("id", row.id);
  const close = () => db.from("pending_email_changes").update({ confirmed_at: null, cancelled_at: now.toISOString() }).eq("id", row.id);
  let done = false;
  try {
    // Still the situation it was asked in? The login is the address it was; the coach still coaches this client; nothing newer is waiting.
    const { data: current } = await db.auth.admin.getUserById(row.profile_id);
    const currentEmail = (current?.user?.email as string | undefined) ?? null;
    if ((row.old_email ?? null) !== currentEmail) {
      await close();
      return { ok: false, reason: "stale" };
    }
    if (row.requested_by && row.group_id) {
      const { data: seat } = await db.from("group_memberships").select("role").eq("group_id", row.group_id).eq("profile_id", row.requested_by).maybeSingle();
      if (seat?.role !== "coach") {
        await close();
        return { ok: false, reason: "stale" };
      }
    }
    const { data: newer } = await db.from("pending_email_changes").select("id").eq("profile_id", row.profile_id).is("confirmed_at", null).is("cancelled_at", null).gt("created_at", row.created_at).limit(1);
    if ((newer ?? []).length > 0) {
      await close();
      return { ok: false, reason: "stale" };
    }

    const { error } = await db.auth.admin.updateUserById(row.profile_id, { email: row.new_email, email_confirm: true });
    if (error) return { ok: false, reason: /already|registered|exists|duplicate/i.test(error.message) ? "taken" : "failed" };
    done = true;
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    if (!done) {
      try {
        await giveBack();
      } catch {
        // the claim could not be given back; the request still expires by itself
      }
    }
  }
  // The client is told in the app; a recent change also pauses sign-in links being sent to a brand-new inbox (lib/resend-access.ts).
  await db.from("notifications").insert({ profile_id: row.profile_id, group_id: row.group_id, type: "email_changed", body: `Your sign-in email is now ${row.new_email}.`, link_path: row.group_id ? `/groups/${row.group_id}` : "/" });
  if (row.old_email && !isPlaceholderEmail(row.old_email) && isEmailConfigured()) {
    await sendEmail(row.old_email, "Your sign-in email was changed", `The sign-in email on your Spotlight Coaching account is now ${maskEmail(row.new_email)}, confirmed from that address. If this was not you, contact your coach right away.`).catch(() => false);
  }
  return { ok: true, email: row.new_email, profileId: row.profile_id };
}

async function cancelRow(db: any, row: { id: string; profile_id: string; group_id: string | null }): Promise<boolean> {
  const { data: changed, error } = await db
    .from("pending_email_changes")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("confirmed_at", null)
    .is("cancelled_at", null)
    .select("id");
  // Only a cancel that really took (no confirm got there first) says so, and writes the notice.
  if (error || (changed ?? []).length === 0) return false;
  await db.from("notifications").insert({ profile_id: row.profile_id, group_id: row.group_id, type: "email_change_cancelled", body: "A change to your sign-in email was cancelled. Nothing changed.", link_path: row.group_id ? `/groups/${row.group_id}` : "/" });
  return true;
}

// The old address (the cancel token) says no: nothing is changed, and the client is told in the app. ok:false when it can no longer be cancelled (already confirmed, expired, or not a valid link).
export async function cancelEmailChange(db: any, token: string, now: Date = new Date()): Promise<{ ok: boolean }> {
  const row = await lookup(db, token, "cancel");
  if (!row || row.confirmed_at) return { ok: false };
  if (row.cancelled_at) return { ok: true }; // already cancelled: nothing changed, which is what they wanted
  if (new Date(row.expires_at) <= now) return { ok: false };
  return { ok: await cancelRow(db, row) };
}

// The signed-in person's own waiting change, if any (what the banner shows), and their own way to cancel it without any link.
export async function pendingForProfile(db: any, profileId: string): Promise<{ newEmail: string } | null> {
  try {
    const { data } = await db.from("pending_email_changes").select("new_email").eq("profile_id", profileId).is("confirmed_at", null).is("cancelled_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data ? { newEmail: maskEmail(data.new_email) } : null;
  } catch {
    return null;
  }
}

export async function cancelPendingForProfile(db: any, profileId: string): Promise<{ ok: boolean; cancelled: number }> {
  const { data } = await db.from("pending_email_changes").select("id, profile_id, group_id").eq("profile_id", profileId).is("confirmed_at", null).is("cancelled_at", null).gt("expires_at", new Date().toISOString());
  let cancelled = 0;
  for (const row of (data ?? []) as { id: string; profile_id: string; group_id: string | null }[]) if (await cancelRow(db, row)) cancelled++;
  return { ok: true, cancelled };
}

// The two emails sent when a change is asked for. The new address gets ONLY the confirm link, the old address ONLY the cancel link.
export async function sendEmailChangeMessages(args: { coachName: string | null; newEmail: string; oldEmail: string | null; confirmLink: string; cancelLink: string; confirmableAt: string; now?: Date }): Promise<{ toNew: boolean; toOld: boolean }> {
  const who = args.coachName ?? "Your coach";
  const now = args.now ?? new Date();
  const waitHours = Math.ceil((new Date(args.confirmableAt).getTime() - now.getTime()) / 3600_000);
  const timing = waitHours > 0 ? `You can confirm it in about ${waitHours} hours (a day is left on purpose so the current address can object), and the link then works for ${EMAIL_CHANGE_HOURS} hours.` : `The link works for ${EMAIL_CHANGE_HOURS} hours.`;
  const toNew = await sendEmail(
    args.newEmail,
    "Confirm your new sign-in email",
    `${who} asked to change the sign-in email on a Spotlight Coaching account to this address.\n\nIf that is you, confirm it here:\n${args.confirmLink}\n\n${timing} Nothing changes until you press Confirm on that page. If this is not you, ignore this message.`
  ).catch(() => false);
  let toOld = false;
  if (args.oldEmail && !isPlaceholderEmail(args.oldEmail)) {
    toOld = await sendEmail(
      args.oldEmail,
      "A change to your sign-in email was asked for",
      `${who} asked to change your sign-in email to ${maskEmail(args.newEmail)}. Nothing has changed yet: it changes only if the owner of that address confirms it, and not before ${waitHours > 0 ? `about ${waitHours} hours from now` : "they do"}.\n\nIf you did not expect this, cancel it here:\n${args.cancelLink}\n\nand tell your coach.`
    ).catch(() => false);
  }
  return { toNew, toOld };
}
