import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countByCoach, toMarkMessage } from "./sessions-to-mark";

// Wave 2 C6 (Ron, Nov 20: "do"): a weekly nudge listing sessions still to mark.
const route = readFileSync(join(__dirname, "..", "app/api/cron/sessions-to-mark/route.ts"), "utf8");

describe("the weekly line", () => {
  it("says how many, once per coach", () => {
    expect(toMarkMessage(1).body).toBe("1 past session is waiting to be marked. Did it happen? One tap each on your calendar.");
    expect(toMarkMessage(3).body).toBe("3 past sessions are waiting to be marked. Did they happen? One tap each on your calendar.");
    expect([...countByCoach([{ coach_id: "a" }, { coach_id: "b" }, { coach_id: "a" }])]).toEqual([["a", 2], ["b", 1]]);
  });
});

describe("the job", () => {
  it("counts the same sessions the 'Did this session happen?' cards list, ended over a day ago", () => {
    expect(route).toContain('.eq("credit_state", "unsettled")');
    expect(route).toContain('.is("attended_at", null)');
    expect(route).toContain('.eq("no_show", false)');
    expect(route).toContain('.lt("end_at", new Date(now - TO_MARK_AFTER_HOURS * 3600000).toISOString())');
  });
  it("reads only: nothing is marked, charged or changed", () => {
    expect(route).not.toMatch(/\.(update|insert|delete|upsert)\(/);
    expect(route).not.toContain(".rpc(");
  });
  it("skips a coach who switched off Bookings, and nudges each coach at most once in six days", () => {
    expect(route).toContain('.includes("bookings")');
    expect(route).toContain("rateLimitAllows(`sessions-to-mark-nudge:${coachId}`, 1, 6 * 86400)");
  });
  it("a phone alert first; an email only when no phone was reached", () => {
    expect(route).toMatch(/if \(reached > 0\) \{\s*pushed \+= 1;\s*continue;\s*\}/);
  });
});
