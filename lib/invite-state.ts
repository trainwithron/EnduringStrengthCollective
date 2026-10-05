// What a coach sees about the invite links they have made: which still work,
// which ran out, which they cancelled. Pure, so it is tested.

const DAY_MS = 24 * 60 * 60 * 1000;
export const KEEP_DEAD_INVITES_DAYS = 7;

export type GroupInviteState = "live" | "expired" | "revoked";

export interface GroupInviteLike {
  expiresAt: string | null;
  revokedAt: string | null;
}

export function groupInviteState(inv: GroupInviteLike, now: Date = new Date()): GroupInviteState {
  if (inv.revokedAt) return "revoked";
  if (inv.expiresAt && new Date(inv.expiresAt) <= now) return "expired";
  return "live";
}

export function daysLeft(expiresAt: string | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

// Live links always show. A revoked or expired one stays visible, greyed, for
// a week after it stopped working, so "where did that link go" has an answer,
// and then drops off the list.
export function shouldListGroupInvite(inv: GroupInviteLike, now: Date = new Date()): boolean {
  const state = groupInviteState(inv, now);
  if (state === "live") return true;
  const stoppedAt = state === "revoked" ? inv.revokedAt : inv.expiresAt;
  if (!stoppedAt) return false;
  return now.getTime() - new Date(stoppedAt).getTime() <= KEEP_DEAD_INVITES_DAYS * DAY_MS;
}

export type ClaimLinkState = "claimed" | "not_sent" | "live" | "expired" | "revoked" | "used";

export interface ClaimInviteLike {
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export interface ClaimLinkDetail {
  state: ClaimLinkState;
  daysLeft: number | null;
  createdAt: string | null;
}

export function claimLinkDetail(input: {
  claimedAt: string | null;
  latestInvite: ClaimInviteLike | null;
  now?: Date;
}): ClaimLinkDetail {
  const now = input.now ?? new Date();
  if (input.claimedAt) return { state: "claimed", daysLeft: null, createdAt: input.latestInvite?.createdAt ?? null };
  const inv = input.latestInvite;
  if (!inv) return { state: "not_sent", daysLeft: null, createdAt: null };
  if (inv.revokedAt) return { state: "revoked", daysLeft: null, createdAt: inv.createdAt };
  if (inv.usedAt) return { state: "used", daysLeft: null, createdAt: inv.createdAt };
  if (new Date(inv.expiresAt) <= now) return { state: "expired", daysLeft: 0, createdAt: inv.createdAt };
  return { state: "live", daysLeft: daysLeft(inv.expiresAt, now), createdAt: inv.createdAt };
}

export const CLAIM_LINK_STATE_LABEL: Record<ClaimLinkState, string> = {
  claimed: "Signed in",
  not_sent: "No link yet",
  live: "Link ready",
  expired: "Link expired",
  revoked: "Link cancelled",
  used: "Link used",
};
