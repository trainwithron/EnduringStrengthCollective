import { describe, expect, it } from "vitest";
import { isHighPriorityClient, findThreadsNeedingReply } from "./notification-priority";

describe("isHighPriorityClient", () => {
  it("is true only for one_on_one", () => {
    expect(isHighPriorityClient("one_on_one")).toBe(true);
    expect(isHighPriorityClient("online")).toBe(false);
    expect(isHighPriorityClient("group")).toBe(false);
    expect(isHighPriorityClient(null)).toBe(false);
  });
});

describe("findThreadsNeedingReply", () => {
  const coachId = "coach-1";
  const now = new Date("2026-09-10T12:00:00Z");

  it("flags a thread whose last comment is a non-coach reply past the window", () => {
    const stale = findThreadsNeedingReply(
      [
        { postId: "p1", groupId: "g1", authorId: "athlete-1", createdAt: "2026-09-10T02:00:00Z" }, // 10h ago
      ],
      coachId,
      now
    );
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ postId: "p1", groupId: "g1" });
  });

  it("does not flag a thread whose last comment is within the window", () => {
    const stale = findThreadsNeedingReply(
      [{ postId: "p1", groupId: "g1", authorId: "athlete-1", createdAt: "2026-09-10T07:00:00Z" }], // 5h ago
      coachId,
      now
    );
    expect(stale).toHaveLength(0);
  });

  it("does not flag a thread the coach already replied to last", () => {
    const stale = findThreadsNeedingReply(
      [
        { postId: "p1", groupId: "g1", authorId: "athlete-1", createdAt: "2026-09-10T01:00:00Z" },
        { postId: "p1", groupId: "g1", authorId: coachId, createdAt: "2026-09-10T02:00:00Z" },
      ],
      coachId,
      now
    );
    expect(stale).toHaveLength(0);
  });

  it("re-flags a thread once a later non-coach reply goes stale again", () => {
    const stale = findThreadsNeedingReply(
      [
        { postId: "p1", groupId: "g1", authorId: "athlete-1", createdAt: "2026-09-10T00:00:00Z" },
        { postId: "p1", groupId: "g1", authorId: coachId, createdAt: "2026-09-10T00:30:00Z" },
        { postId: "p1", groupId: "g1", authorId: "athlete-1", createdAt: "2026-09-10T01:00:00Z" },
      ],
      coachId,
      now
    );
    expect(stale).toHaveLength(1);
  });

  it("handles multiple posts independently", () => {
    const stale = findThreadsNeedingReply(
      [
        { postId: "p1", groupId: "g1", authorId: "athlete-1", createdAt: "2026-09-10T01:00:00Z" }, // stale
        { postId: "p2", groupId: "g1", authorId: "athlete-2", createdAt: "2026-09-10T11:00:00Z" }, // fresh
      ],
      coachId,
      now
    );
    expect(stale.map((s) => s.postId)).toEqual(["p1"]);
  });

  it("respects a custom staleness window", () => {
    const stale = findThreadsNeedingReply(
      [{ postId: "p1", groupId: "g1", authorId: "athlete-1", createdAt: "2026-09-10T10:00:00Z" }], // 2h ago
      coachId,
      now,
      1
    );
    expect(stale).toHaveLength(1);
  });
});
