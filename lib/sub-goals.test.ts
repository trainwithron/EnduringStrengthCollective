import { describe, it, expect } from "vitest";
import { nextSubGoalStatus, subGoalPill, visibleSubGoals } from "@/lib/sub-goals";

const coach = "coach-1";
const client = "client-1";

describe("smaller goals: who can do what", () => {
  it("only the other side answers a proposal", () => {
    expect(nextSubGoalStatus({ status: "proposed", proposedBy: coach, actorId: client, action: "agree" })).toBe("agreed");
    expect(nextSubGoalStatus({ status: "proposed", proposedBy: coach, actorId: client, action: "decline" })).toBe("declined");
    expect(nextSubGoalStatus({ status: "proposed", proposedBy: coach, actorId: coach, action: "agree" })).toBeNull();
    expect(nextSubGoalStatus({ status: "proposed", proposedBy: client, actorId: client, action: "decline" })).toBeNull();
  });
  it("either side finishes an agreed one, and nothing else moves", () => {
    expect(nextSubGoalStatus({ status: "agreed", proposedBy: coach, actorId: coach, action: "done" })).toBe("done");
    expect(nextSubGoalStatus({ status: "agreed", proposedBy: coach, actorId: client, action: "done" })).toBe("done");
    expect(nextSubGoalStatus({ status: "proposed", proposedBy: coach, actorId: client, action: "done" })).toBeNull();
    expect(nextSubGoalStatus({ status: "declined", proposedBy: coach, actorId: client, action: "agree" })).toBeNull();
    expect(nextSubGoalStatus({ status: "done", proposedBy: coach, actorId: client, action: "agree" })).toBeNull();
    expect(nextSubGoalStatus({ status: "agreed", proposedBy: coach, actorId: client, action: "agree" })).toBeNull();
  });
  it("says who it is waiting on", () => {
    expect(subGoalPill({ status: "proposed", proposedBy: client, viewerId: client, otherName: "your coach" })).toBe("Waiting for your coach");
    expect(subGoalPill({ status: "proposed", proposedBy: coach, viewerId: coach, otherName: "Anna" })).toBe("Waiting for Anna");
    expect(subGoalPill({ status: "proposed", proposedBy: coach, viewerId: client, otherName: "your coach" })).toBe("Waiting for you");
    expect(subGoalPill({ status: "agreed", proposedBy: coach, viewerId: client, otherName: "x" })).toBe("Agreed");
    expect(subGoalPill({ status: "done", proposedBy: coach, viewerId: client, otherName: "x" })).toBe("Done");
  });
  it("does not list ones that were turned down", () => {
    expect(visibleSubGoals([{ status: "declined" as const }, { status: "agreed" as const }])).toEqual([{ status: "agreed" }]);
  });
});
