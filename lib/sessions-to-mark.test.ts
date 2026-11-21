import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countByCoach, toMarkMessage } from "./sessions-to-mark";

// Wave 2 C6 (Ron, Nov 20: "do"): a weekly nudge listing sessions still to mark.
const route = readFileSync(join(__dirname, "..", "app/api/cron/sessions-to-mark/route.ts"), "utf8").replace(/\r\n/g, "\n");

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
  it("reads every page of them (the database answers 1000 rows a request), and a failed page sends nothing", () => {
    expect(route).toContain("await pageAll(");
    expect(route).toMatch(/\.order\("id"\)\s*\.range\(from, to\)/);
    expect(route).toContain('if (failed) return NextResponse.json({ error: "Could not read the sessions." }, { status: 500 });');
  });
  it("nothing about a session is marked, charged or changed: the only write is the record that a coach was reached", () => {
    expect(route).not.toMatch(/\.(update|insert|delete)\(/);
    expect(route).not.toContain(".rpc(");
    expect(route.match(/\.upsert\(/g)?.length).toBe(1);
    expect(route).toContain('db.from("coach_nudges").upsert(');
  });
  it("skips a coach who switched off Bookings, and one reached in the last six days; without that record nobody is nudged", () => {
    expect(route).toContain('.includes("bookings")');
    expect(route).toContain('.eq("kind", NUDGE_KIND).gte("sent_at", since)');
    expect(route).toContain('if (nudgeError) return NextResponse.json({ error: "Could not read who was nudged." }, { status: 500 });');
  });
  it("a phone alert first; an email only when no phone was reached; only a delivered line uses up the week", () => {
    expect(route).toMatch(/if \(reached > 0\) \{\s*pushed \+= 1;\s*await markNudged\(coachId\);\s*continue;\s*\}/);
    expect(route).toMatch(/=== "sent"\) \{\s*emailed \+= 1;\s*await markNudged\(coachId\);\s*\}/);
    expect(route.match(/await markNudged\(coachId\)/g)?.length).toBe(2);
  });
});
