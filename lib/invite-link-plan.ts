import { groupInviteState, daysLeft } from "./invite-state";

// A group has ONE current invite link (Ron, Oct 6: "why does there need to be more than one invite link?"). A new link replaces the old one. It lasts 7 days
// (extendable) unless the coach chooses "Never expires" (Oct 27, for a poster on a gym wall): it then works until the coach cancels it or makes a new one. Any other
// link that still works (older ones from before the one-link rule) is shown only so it can be cancelled.

export interface InviteLinkRow {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface InviteLinkPlan {
  // The one link to show, copy and put on a QR code: the newest working link. `daysLeft` is null when it never expires.
  current: (InviteLinkRow & { daysLeft: number | null; neverExpires: boolean }) | null;
  // Every other working link: shown only to cancel. `neverExpires` ones are flagged.
  extra: (InviteLinkRow & { neverExpires: boolean })[];
}

export function planInviteLinks(invites: InviteLinkRow[], now: Date = new Date()): InviteLinkPlan {
  const live = invites
    .filter((i) => groupInviteState({ expiresAt: i.expiresAt, revokedAt: i.revokedAt }, now) === "live")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const currentRow = live[0] ?? null;
  const current = currentRow ? { ...currentRow, daysLeft: currentRow.expiresAt === null ? null : (daysLeft(currentRow.expiresAt, now) ?? 0), neverExpires: currentRow.expiresAt === null } : null;
  const extra = live.slice(1).map((i) => ({ ...i, neverExpires: i.expiresAt === null }));
  return { current, extra };
}

// How long the current link works, in the panel's words.
export function linkLifetimeText(current: { daysLeft: number | null; neverExpires: boolean }): string {
  if (current.neverExpires) return "never expires";
  return `works for ${current.daysLeft} more ${current.daysLeft === 1 ? "day" : "days"}`;
}

export const NEVER_EXPIRES_NOTE = "Never expires: it works until you cancel it or make a new link. Good for a poster.";

// When a new or extended link stops working: 7 days from now, or never (null) when the coach chose "Never expires". Only an explicit true means never.
export function inviteExpiresAt(neverExpires: unknown, now: number = Date.now()): string | null {
  return neverExpires === true ? null : new Date(now + LINK_LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export const SINGLE_LINK_NOTE = "A new link replaces the old one: the old link stops working.";
export const LINK_LIFETIME_DAYS = 7;
