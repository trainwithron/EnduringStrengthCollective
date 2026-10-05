import { describe, expect, it } from "vitest";
import { attentionCounts, attentionFromSources, attentionHeadline, buildSchedule, rankAttention } from "./your-day";

const reply = { postId: "p1", groupId: "g1", groupName: "Team", channel: "general", authorName: "Ann", snippet: "Is this ok?" };
const pay = (name: string, balance: number) => ({ athleteId: name, groupId: "g1", name, balance });

describe("attentionFromSources", () => {
  it("turns each source into a plain sentence with a link", () => {
    const items = attentionFromSources({
      replies: [reply],
      payments: [pay("Bo", 0), pay("Cy", -2)],
      readiness: [{ athleteId: "d", groupId: "g1", name: "Di" }],
      insights: [{ id: "i1", headline: "Ed's squat is climbing", athleteId: "e", groupId: "g1" }],
      notices: [{ id: "n1", body: "A trainer asked for a client", linkPath: "/admin", createdAt: "2026-10-05T10:00:00Z" }],
    });
    expect(items.map((i) => i.text)).toEqual([
      "Ann is waiting for a reply in Team",
      "Bo is out of sessions",
      "Cy is out of sessions (owed 2)",
      "Di checked in low on readiness today",
      "Ed's squat is climbing",
      "A trainer asked for a client",
    ]);
    expect(items[0].href).toBe("/groups/g1/feed?channel=general&highlight=p1");
    expect(items[1].href).toBe("/groups/g1/athletes/Bo");
  });
  it("never lists the same thing twice", () => {
    expect(attentionFromSources({ payments: [pay("Bo", 0), pay("Bo", 0)] })).toHaveLength(1);
  });
  it("is empty when nothing is wrong", () => {
    expect(attentionFromSources({})).toEqual([]);
  });
});

describe("rankAttention", () => {
  const items = attentionFromSources({
    replies: [reply],
    payments: [pay("Bo", 0), pay("Cy", -2)],
    readiness: [{ athleteId: "d", groupId: "g1", name: "Di" }],
    insights: [{ id: "i1", headline: "insight", athleteId: "e", groupId: "g1" }],
    notices: [
      { id: "n1", body: "older", linkPath: "/a", createdAt: "2026-10-04T10:00:00Z" },
      { id: "n2", body: "newer", linkPath: "/b", createdAt: "2026-10-05T10:00:00Z" },
    ],
  });
  it("puts what matters today first, then replies, then the rest", () => {
    const { shown } = rankAttention(items, 10);
    expect(shown.map((i) => i.kind)).toEqual(["readiness", "payment", "payment", "reply", "insight", "notice", "notice"]);
    // owed (negative) before just-zero
    expect(shown[1].text).toContain("Cy");
    // newer notice first
    expect(shown[5].text).toBe("newer");
  });
  it("caps the list and says how many are hidden", () => {
    const { shown, hidden } = rankAttention(items, 3);
    expect(shown).toHaveLength(3);
    expect(hidden).toBe(4);
  });
  it("counts by kind and words the headline", () => {
    expect(attentionCounts(items)).toEqual({ reply: 1, payment: 2, readiness: 1, insight: 1, notice: 2 });
    expect(attentionHeadline(0)).toBe("Nothing needs you right now");
    expect(attentionHeadline(1)).toBe("1 thing needs you");
    expect(attentionHeadline(5)).toBe("5 things need you");
  });
});

describe("buildSchedule", () => {
  const booking = (id: string, athleteId: string, startAt: string) => ({ id, athleteId, groupId: "g1", athleteName: athleteId, groupName: "Team", startAt, needsPayment: false });
  it("lists sessions and classes together in time order", () => {
    const rows = buildSchedule(
      "coach",
      [booking("b2", "Bo", "2026-10-05T17:00:00Z"), booking("b1", "Ann", "2026-10-05T13:00:00Z")],
      [{ id: "c1", title: "Boot camp", startAt: "2026-10-05T15:00:00Z", endAt: "2026-10-05T16:00:00Z", capacity: 8, joined: 5, waitlisted: 0, groupId: "g1" }]
    );
    expect(rows.map((r) => r.title)).toEqual(["Ann", "Boot camp", "Bo"]);
    expect(rows[1]).toMatchObject({ kind: "class", detail: "5 of 8 spots taken", href: "/groups/g1/group-sessions" });
  });
  it("drops a class's hidden anchor booking (the coach's own booking)", () => {
    const rows = buildSchedule("coach", [booking("anchor", "coach", "2026-10-05T15:00:00Z")], []);
    expect(rows).toEqual([]);
  });
  it("mentions a waiting list", () => {
    const rows = buildSchedule("coach", [], [{ id: "c", title: "Class", startAt: "x", endAt: "y", capacity: 4, joined: 4, waitlisted: 2, groupId: "g" }]);
    expect(rows[0].detail).toBe("4 of 4 spots taken, 2 waiting");
  });
});
