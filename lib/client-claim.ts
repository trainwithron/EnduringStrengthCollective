import { createHash, randomBytes } from "crypto";

// Pre-signup client profiles: a coach creates a REAL account for a client
// silently (no email is sent), builds everything for them, and later hands
// over a single-use claim link. The pieces here are pure so they're testable.

// The placeholder address helpers live in ./placeholder-email (no server-only imports, so the edge middleware can use them too).
export { PLACEHOLDER_EMAIL_DOMAIN, placeholderEmailFor, isPlaceholderEmail } from "./placeholder-email";

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
// finishing_setup: the link was used (they tapped Continue) but they have not finished the
// set-password step yet, so the account is still unclaimed.
export type ClaimStatus = "not_signed_in" | "invite_created" | "finishing_setup" | "active";

const FINISHING_SETUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function claimStatus(input: {
  claimedAt: string | null;
  // The most recent invite the coach created for this client, if any.
  latestInvite: { expiresAt: string; usedAt: string | null; revokedAt?: string | null } | null;
  now?: Date;
}): ClaimStatus {
  if (input.claimedAt) return "active";
  const now = input.now ?? new Date();
  const inv = input.latestInvite;
  if (inv && !inv.usedAt && new Date(inv.expiresAt) > now) return "invite_created";
  // Used but not claimed: they are partway through. A cancelled link is also marked used, so a link
  // known to be cancelled is excluded, and only a recent use counts (a stale one just means they stopped).
  if (inv && inv.usedAt && !inv.revokedAt && now.getTime() - new Date(inv.usedAt).getTime() <= FINISHING_SETUP_WINDOW_MS) {
    return "finishing_setup";
  }
  return "not_signed_in";
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  not_signed_in: "Not signed in yet",
  invite_created: "Sign-in link created",
  finishing_setup: "Link used, finishing setup",
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

// The plain email a coach sends a client with their sign-in link (the same message as the text, but from the coach's name).
export function buildClaimEmail(link: string, clientFirstName: string, coachName: string | null): { subject: string; text: string } {
  const coach = coachName?.trim() || "Your coach";
  const hi = clientFirstName ? `Hi ${clientFirstName},` : "Hi,";
  return {
    subject: `${coach} invited you to Spotlight Coaching`,
    text: [
      hi,
      "",
      `${coach} set up your training in Spotlight Coaching. Tap this link to sign in and get started:`,
      "",
      link,
      "",
      `The link works once and expires in ${CLAIM_LINK_LIFETIME_HOURS} hours. If you weren't expecting this, you can ignore this email.`,
    ].join("\n"),
  };
}
