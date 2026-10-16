// Taking back a group that was just made and never used (the coach seat could not be made, or the add-client box was closed before anyone was added). A signed-in person cannot delete a group directly
// (there is no delete rule on groups), so this goes through a server route that decides with the rules below. Pure here; the route does the reading and the deleting.
export const DISCARD_WINDOW_MS = 60 * 60 * 1000; // only a group made in the last hour

export interface DiscardFacts {
  createdBy: string | null;
  createdAt: string | null;
  groupKind: string | null;
  // People in the group other than the creator, and how many of them are clients.
  otherMembers: number;
  athleteMembers: number;
  // Programs, sessions or posts already filed in the group.
  hasContent: boolean;
}

// Returns null when the group may be discarded, else the reason it may not.
export function discardRefusal(facts: DiscardFacts, userId: string, now: Date = new Date()): string | null {
  if (!facts.createdBy || facts.createdBy !== userId) return "Only the person who made a group can discard it.";
  const made = facts.createdAt ? new Date(facts.createdAt).getTime() : NaN;
  if (!Number.isFinite(made) || now.getTime() - made > DISCARD_WINDOW_MS) return "That group is not new any more.";
  if (facts.athleteMembers > 0 || facts.otherMembers > 0) return "That group has people in it.";
  if (facts.hasContent) return "That group already has things in it.";
  return null;
}

// Asks the server to discard the group; resolves to whether it is gone. Never throws.
export async function discardEmptyGroup(groupId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/groups/discard-empty", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId }) });
    return res.ok;
  } catch {
    return false;
  }
}
