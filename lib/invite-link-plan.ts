import { groupInviteState, daysLeft } from "./invite-state";

// A group has ONE current invite link (Ron, Oct 6: "why does there need to be more than one invite link?"). A new link replaces the old one, and a link never lasts
// forever: 7 days, extendable. Any other link that still works (older ones from before this rule, and any with no expiry) is shown only so it can be cancelled.

export interface InviteLinkRow {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface InviteLinkPlan {
  // The one link to show and copy: the newest working link that expires.
  current: (InviteLinkRow & { daysLeft: number }) | null;
  // Every other working link: shown only to cancel. `neverExpires` ones are flagged.
  extra: (InviteLinkRow & { neverExpires: boolean })[];
}

export function planInviteLinks(invites: InviteLinkRow[], now: Date = new Date()): InviteLinkPlan {
  const live = invites
    .filter((i) => groupInviteState({ expiresAt: i.expiresAt, revokedAt: i.revokedAt }, now) === "live")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const currentRow = live.find((i) => i.expiresAt !== null) ?? null;
  const current = currentRow ? { ...currentRow, daysLeft: daysLeft(currentRow.expiresAt, now) ?? 0 } : null;
  const extra = live.filter((i) => i !== currentRow).map((i) => ({ ...i, neverExpires: i.expiresAt === null }));
  return { current, extra };
}

export const SINGLE_LINK_NOTE = "A new link replaces the old one: the old link stops working.";
export const LINK_LIFETIME_DAYS = 7;
