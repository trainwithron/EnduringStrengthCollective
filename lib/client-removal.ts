// Taking a client out of a group (Release Z1). "Remove from my clients" keeps their account and data and can be undone at any time; "Delete permanently" is the same removal with a 30-day window to undo, after which the account
// is erased (see lib/client-removal-server.ts). The words the coach reads live here so the menu, the profile and the list say the same thing.
export const UNDO_DAYS = 30;

export const REMOVE_CONFIRM = (name: string) =>
  `Remove ${name} from your clients? They disappear from your lists and counts and lose access to this group. Their account and everything about them are kept, and you can put them back whenever you like.`;

export const DELETE_CONFIRM = (name: string) =>
  `Delete ${name} permanently? They are taken out of your clients now. You have ${UNDO_DAYS} days to change your mind; after that their account and data are erased and cannot be brought back.`;

export function daysLeft(deleteAfter: string | null | undefined, now: Date = new Date()): number | null {
  if (!deleteAfter) return null;
  const ms = new Date(deleteAfter).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export function removalLine(removal: { removedAt: string; deleteAfter: string | null }, now: Date = new Date()): string {
  const left = daysLeft(removal.deleteAfter, now);
  if (left === null) return `Removed ${new Date(removal.removedAt).toLocaleDateString()}. Their account and data are kept.`;
  return left === 0 ? "Deleted for good today unless you put them back." : `Deleted for good in ${left} day${left === 1 ? "" : "s"} unless you put them back.`;
}
