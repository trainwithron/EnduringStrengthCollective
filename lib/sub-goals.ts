// Smaller goals under a client's goal: either side adds one, the OTHER side agrees or says not now, and an agreed one can be marked done by either side. Pure rules, used by the server route
// (which is the only thing that changes a state) and by the screen (which only shows the right buttons).

export type SubGoalStatus = "proposed" | "agreed" | "declined" | "done";
export type SubGoalAction = "agree" | "decline" | "done";

export interface SubGoalView {
  id: string;
  title: string;
  targetDate: string | null;
  proposedBy: string;
  status: SubGoalStatus;
}

// The new state, or null when this person cannot do this now. Only the side that did NOT add it answers a proposal; either side finishes an agreed one.
export function nextSubGoalStatus(opts: { status: SubGoalStatus; proposedBy: string; actorId: string; action: SubGoalAction }): SubGoalStatus | null {
  const { status, proposedBy, actorId, action } = opts;
  if (status === "proposed" && (action === "agree" || action === "decline")) {
    if (actorId === proposedBy) return null;
    return action === "agree" ? "agreed" : "declined";
  }
  if (status === "agreed" && action === "done") return "done";
  return null;
}

export const SUB_GOALS_HEADING = "Smaller goals";
export const SUB_GOALS_EMPTY = "No smaller goals yet.";

// What the person sees next to one: who it is waiting on, or its state. `otherName` is the client's first name for a coach, "your coach" for a client.
export function subGoalPill(opts: { status: SubGoalStatus; proposedBy: string; viewerId: string; otherName: string }): string {
  const { status, proposedBy, viewerId, otherName } = opts;
  if (status === "done") return "Done";
  if (status === "agreed") return "Agreed";
  if (status === "proposed") return proposedBy === viewerId ? `Waiting for ${otherName}` : "Waiting for you";
  return "Not now";
}

// Declined ones are not listed.
export function visibleSubGoals<T extends { status: SubGoalStatus }>(items: T[]): T[] {
  return items.filter((i) => i.status !== "declined");
}
