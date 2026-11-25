import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRunToken, issueRunToken, runTokenIsStale } from "@/lib/ai-day-run";
import { detectBiomechRedundancy, isSingleJoint } from "@/lib/programming-spotter";

// The Assistant's review of 6fcc3819 (spotter-builder cross-check).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("MEDIUM: a day written twice (the one retry) is still one run", () => {
  const now = 1_800_000_000_000;
  it("day 1 makes two logged calls (first try + repair); day 2 with its token is the same run, not a new one", () => {
    // day 1: no token yet, a new run (charged once); 2 calls logged; the token says 1 day, 2 calls
    const day1 = issueRunToken("coach", "prog", 1, now, now, 0 + 2);
    const run = checkRunToken(day1, "coach", "prog", now + 20_000);
    expect(run).toEqual({ ok: true, days: 1, calls: 2, issuedAt: now });
    // day 2: the log shows 2 calls since the run began -> not stale, so no new charge and no second free-tier use
    expect(runTokenIsStale(2, run.ok ? run.calls : 0)).toBe(false);
    // the old count (days) would have called it stale
    expect(runTokenIsStale(2, 1)).toBe(true);
    // day 2 makes one call: its token carries 3
    const day2 = issueRunToken("coach", "prog", 2, now + 40_000, now, (run.ok ? run.calls : 0) + 1);
    expect(checkRunToken(day2, "coach", "prog", now + 41_000)).toEqual({ ok: true, days: 2, calls: 3, issuedAt: now });
  });
  it("an old token reused after a newer one is still stale (more calls logged than it carries)", () => {
    const old = checkRunToken(issueRunToken("coach", "prog", 1, now, now, 1), "coach", "prog", now + 1000);
    expect(runTokenIsStale(3, old.ok ? old.calls : 0)).toBe(true);
  });
  it("a token from before this change (no call count) reads its days as its calls; days stay the run's cap", () => {
    // signed the way an older deploy signed it: the same secret, a body with no c
    const secret = process.env.AI_RUN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-only-secret";
    const body = Buffer.from(JSON.stringify({ u: "coach", p: "prog", t: now, d: 2 })).toString("base64url");
    const legacy = `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
    expect(checkRunToken(legacy, "coach", "prog", now + 1)).toEqual({ ok: true, days: 2, calls: 2, issuedAt: now });
  });
  it("the route counts the calls that came back, checks them, and carries them on the next token; a new run still pays once", () => {
    const route = read("app/api/ai/build-day/route.ts");
    expect(route).toContain("if (runTokenIsStale(count ?? 0, run.calls)) run = { ok: false };");
    expect(route).toContain("    calls++;\n    const parsed = readDayResult(");
    expect(route).toContain("run.ok ? run.issuedAt : startedAt, (run.ok ? run.calls : 0) + calls),");
    // the free-tier use and the allowance check are only for a new run
    const charge = route.slice(route.indexOf("if (!run.ok) {\n    const canRun"), route.indexOf("// The days already in the program"));
    expect(charge).toContain('freeTierUseOrRefuse(user.id, "program")');
    expect(route.split('freeTierUseOrRefuse(user.id, "program")')).toHaveLength(2);
    // the log count leaves out what the token does not count
    expect(route).toContain('.neq("status", "error")');
    expect(route).toContain('.neq("status", "truncated")');
  });
});

describe("LOW: only a note kept on purpose is left alone on later days", () => {
  it("the day says whether it was kept with a reason; the chat skips only those, and says every line once", () => {
    const route = read("app/api/ai/build-day/route.ts");
    const chat = read("components/coach/desktop/program-builder-chat.tsx");
    expect(route).toContain("onPurpose: !!result.kept");
    expect(chat).toContain("if (k.onPurpose === true && !keptKeys.current.includes(k.key)) keptKeys.current = [...keptKeys.current, k.key];");
    expect(chat).toContain("saidKeys.current = [...saidKeys.current, k.key];");
    expect(chat).toContain("    saidKeys.current = [];");
  });
});

describe("NIT: a tag on no joint is not a joint of its own", () => {
  it("stabilization-kind keys (no joint) are left out; a curl with one is still single-joint", () => {
    expect(isSingleJoint({ primeMoverTagKeys: ["elbow_flexion", "anti_rotation"], primeMoverJoints: ["elbow", null] })).toBe(true);
    expect(isSingleJoint({ primeMoverTagKeys: ["elbow_flexion", "unilateral_loading"] })).toBe(true);
    expect(isSingleJoint({ primeMoverTagKeys: ["anti_extension", "closed_kinetic_chain"] })).toBe(false);
    // a joint-action tag whose joint is missing still reads its joint from the key
    expect(isSingleJoint({ primeMoverTagKeys: ["shoulder_extension", "elbow_flexion"], primeMoverJoints: [null, null] })).toBe(false);
  });
  it("three curls each also tagged unilateral_loading flag once, on elbow flexion only", () => {
    const e = (n: string) => ({ exerciseName: n, weekNumber: 1, workoutId: "d", dayIndex: 1, primeMoverTagKeys: ["elbow_flexion", "unilateral_loading"], primeMoverJoints: ["elbow", null] });
    expect(detectBiomechRedundancy([e("A"), e("B"), e("C")]).map((f) => f.tagKey)).toEqual(["elbow_flexion"]);
  });
});

describe("the step 229 rehearsal runs with the rest", () => {
  it("is part of npm run test:sql", () => {
    expect(JSON.parse(read("package.json")).scripts["test:sql"]).toContain("node scripts/sql-tests/program-for-client.test.mjs");
  });
});
