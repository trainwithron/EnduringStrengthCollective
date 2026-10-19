import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { digestText, planLowSessionDigests, shortClientName, type LowCreditRow } from "@/lib/low-session-digest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19, 5:26 AM Las Vegas: five pushes in a minute, "One session left: renewal window" x3 (Cindie, Karina, Oliver), "Last session..." (Sawyer), and Oliver again at 2 left.
const RON = "ron";
const row = (athleteId: string, balance: number, over: Partial<LowCreditRow> = {}): LowCreditRow => ({ athleteId, groupId: `g-${athleteId}`, balance, alertLevel: null, paymentHold: false, ...over });
const names = new Map([
  ["cindie", "Cindie Downing"],
  ["karina", "Karina Ramirez"],
  ["oliver", "Oliver Bourne"],
  ["sawyer", "Sawyer Steele"],
]);
const baseInput = (rows: LowCreditRow[], hour = 8, recipients: (g: string, a: string) => string[] = () => [RON]) => ({
  rows,
  names,
  localHourForGroup: () => hour,
  recipientsByGroupAthlete: recipients,
});

describe("the 5 AM burst becomes ONE push", () => {
  const rows = [row("cindie", 1), row("karina", 1), row("oliver", 1), row("oliver", 2, { groupId: "g-oliver-b" }), row("sawyer", 0)];
  it("one digest for the coach/owner (the same person), every client once, lowest first, in short names", () => {
    const plan = planLowSessionDigests(baseInput(rows));
    expect(plan.pushes).toHaveLength(1);
    const p = plan.pushes[0];
    expect(p.recipientId).toBe(RON);
    expect(p.title).toBe("4 clients are running low");
    expect(p.body).toBe("Sawyer S. 0 left, Cindie D. 1 left, Karina R. 1 left, Oliver B. 1 left");
    expect(p.url).toBe("/clients");
    expect(plan.pushes[0].clients.filter((c) => c.name === "Oliver B.")).toHaveLength(1);
  });
  it("Oliver's second seat at '2 left' does not push (no '2 left' / '3 left' alerts any more) but is remembered quietly", () => {
    const plan = planLowSessionDigests(baseInput(rows));
    expect(plan.alerted.map((a) => a.athleteId).sort()).toEqual(["cindie", "karina", "oliver", "sawyer"]);
    expect(plan.levelUpdates).toContainEqual({ athleteId: "oliver", groupId: "g-oliver-b", level: 3 });
    expect(plan.levelUpdates).toContainEqual({ athleteId: "sawyer", groupId: "g-sawyer", level: 0 });
    expect(plan.levelUpdates).toContainEqual({ athleteId: "cindie", groupId: "g-cindie", level: 1 });
  });
  it("a client alerted at a tier is never alerted again at the same tier, and a lower tier alerts once", () => {
    expect(planLowSessionDigests(baseInput([row("cindie", 1, { alertLevel: 1 })])).pushes).toHaveLength(0);
    const down = planLowSessionDigests(baseInput([row("cindie", 0, { alertLevel: 1 })]));
    expect(down.pushes[0].title).toBe("Cindie D. is running low");
    expect(down.pushes[0].body).toContain("0 left");
    expect(down.pushes[0].url).toBe("/groups/g-cindie/athletes/cindie");
  });
  it("a client with seats in two groups is one person, told about once, and neither seat repeats tomorrow", () => {
    const plan = planLowSessionDigests(baseInput([row("cindie", 1), row("cindie", 1, { groupId: "g-cindie-2" })]));
    expect(plan.pushes).toHaveLength(1);
    expect(plan.pushes[0].clients).toHaveLength(1);
    expect(plan.levelUpdates.filter((u) => u.athleteId === "cindie")).toHaveLength(2);
  });
  it("a client on payment hold is never alerted", () => {
    expect(planLowSessionDigests(baseInput([row("cindie", 0, { paymentHold: true })])).pushes).toHaveLength(0);
  });
});

describe("when it is sent", () => {
  it("only at 8:00 in the coach's own morning: at 5 AM, 7 AM, 9 AM or 9 PM nothing is sent and nothing is marked", () => {
    for (const hour of [0, 5, 7, 9, 12, 21, 23]) {
      const plan = planLowSessionDigests(baseInput([row("cindie", 1), row("sawyer", 0)], hour));
      expect(plan.pushes, `hour ${hour}`).toHaveLength(0);
      expect(plan.levelUpdates, `hour ${hour}`).toHaveLength(0);
    }
    expect(planLowSessionDigests(baseInput([row("cindie", 1)], 8)).pushes).toHaveLength(1);
  });
  it("each group is judged by its own coach's clock", () => {
    const plan = planLowSessionDigests({ ...baseInput([row("cindie", 1), row("sawyer", 0)]), localHourForGroup: (g) => (g === "g-cindie" ? 8 : 5) });
    expect(plan.pushes).toHaveLength(1);
    expect(plan.pushes[0].clients.map((c) => c.name)).toEqual(["Cindie D."]);
    expect(plan.levelUpdates.some((u) => u.athleteId === "sawyer")).toBe(false);
  });
});

describe("who is told", () => {
  it("each recipient gets their own single digest; the owner is left out of a client who is private from the organization", () => {
    const plan = planLowSessionDigests(
      baseInput([row("cindie", 1), row("karina", 1)], 8, (g, a) => (a === "karina" ? ["coach"] : ["coach", "owner"]))
    );
    const by = new Map(plan.pushes.map((p) => [p.recipientId, p]));
    expect(by.get("coach")?.title).toBe("2 clients are running low");
    expect(by.get("owner")?.title).toBe("Cindie D. is running low");
  });
});

describe("the words", () => {
  it("short names", () => {
    expect(shortClientName("Oliver Bourne")).toBe("Oliver B.");
    expect(shortClientName("Cher")).toBe("Cher");
    expect(shortClientName("  ")).toBe("A client");
  });
  it("a long list names six and counts the rest", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ athleteId: `a${i}`, groupId: "g", name: `N${i} X.`, balance: 1 }));
    const t = digestText(many);
    expect(t.title).toBe("9 clients are running low");
    expect(t.body.endsWith(", and 3 more")).toBe(true);
  });
});

describe("wiring", () => {
  it("the immediate push is gone: the route only answers, and the hourly job sends the digest through the one switch-checking sender", () => {
    const route = read("app/api/credits/low-balance-check/route.ts");
    expect(route).not.toContain("sendPushToProfile");
    expect(route).toContain("notified: null");
    const cron = read("app/api/cron/low-session-digest/route.ts");
    expect(cron).toContain('sendCoachPush(db, p.recipientId, "low_sessions"');
    expect(cron).not.toContain("sendPushToProfile(");
    expect(read("lib/coach-notice.ts")).toContain("if (await coachNoticeIsOff(db, profileId, kind)) return 0;");
    expect(read("vercel.json")).toContain('"path": "/api/cron/low-session-digest"');
    expect(read("lib/cron-jobs.ts")).toContain('{ job: "low-session-digest", path: "/api/cron/low-session-digest", maxAgeHours: FREQUENT }');
  });
});
