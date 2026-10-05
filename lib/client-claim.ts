import { createHash, randomBytes } from "crypto";

// Pre-signup client profiles: a coach creates a REAL account for a client
// silently (no email is sent), builds everything for them, and later hands
// over a single-use claim link. The pieces here are pure so they're testable.

// The account needs an email address to exist; when the coach doesn't have
// one yet it gets a placeholder that can never receive mail, replaced with
// the client's real email when they claim the account.
export const PLACEHOLDER_EMAIL_DOMAIN = "pending.invalid";

export function placeholderEmailFor(seed: string): string {
  return `client-${seed.replace(/[^a-z0-9]/gi, "").slice(0, 16).toLowerCase()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

// A claim link is a full account credential sent by text message, so it is short-lived.
// A new one is a single tap for the coach.
export const CLAIM_LINK_LIFETIME_HOURS = 48;

export const MIN_PASSWORD_LENGTH = 6;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The email a client types when claiming a coach-created account. It becomes their
// sign-in and password-reset address with no verification email, so a typo strands
// them: ask twice, and compare before anything is changed.
export function validateClaimEmail(email: string, confirm: string): string | null {
  const a = email.trim();
  const b = confirm.trim();
  if (!EMAIL_PATTERN.test(a)) return "Enter your email address.";
  if (a.toLowerCase() !== b.toLowerCase()) return "The two emails don't match. Check for a typo.";
  return null;
}

export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

// 32 random bytes, URL-safe. Only its sha256 is ever stored.
export function generateClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// What the coach sees per client (the short checklist state).
export type ClaimStatus = "not_signed_in" | "invite_created" | "active";

export function claimStatus(input: {
  claimedAt: string | null;
  // The most recent invite the coach created for this client, if any.
  latestInvite: { expiresAt: string; usedAt: string | null } | null;
  now?: Date;
}): ClaimStatus {
  if (input.claimedAt) return "active";
  const now = input.now ?? new Date();
  const inv = input.latestInvite;
  if (inv && !inv.usedAt && new Date(inv.expiresAt) > now) return "invite_created";
  return "not_signed_in";
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  not_signed_in: "Not signed in yet",
  invite_created: "Invite link created",
  active: "Active",
};

// A text message from the coach's own phone (an sms: link, so no Twilio and
// no consent question — the coach is texting their own client by hand).
export function buildClaimSms(link: string, clientFirstName: string, coachFirstName?: string | null): string {
  const hi = clientFirstName ? `Hi ${clientFirstName}! ` : "Hi! ";
  const from = coachFirstName ? ` — ${coachFirstName}` : "";
  return `${hi}Your training is all set up. Tap this link to sign in and start: ${link}${from}`;
}

// iOS and Android both accept `sms:?&body=` (no number: the coach picks the
// recipient or it opens the thread they choose).
export function smsHref(body: string): string {
  return `sms:?&body=${encodeURIComponent(body)}`;
}
