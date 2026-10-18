import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDobGate, mayRememberPass, maySkipGateCheck, signDobOk } from "./dob-gate";
import { API_GATE_EXEMPT_PREFIXES, apiGateApplies, dobGatedPage, intakeGateApplies } from "./gate-paths";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const teenDob = `${new Date().getFullYear() - 15}-01-01`;
const childDob = `${new Date().getFullYear() - 10}-01-01`;

// A stand-in database; any table can be made to fail.
function fake(opts: { memberships: { group_id: string; role: string }[]; dob?: string | null; guardian?: string; failMemberships?: boolean; orgRoles?: number; frontDesk?: number; failTable?: string }) {
  const builder = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: table === "client_intake" && opts.dob ? { date_of_birth: opts.dob } : null, error: null }),
      limit: () => b,
      then: (resolve: (v: unknown) => void) => {
        if (opts.failTable === table) return resolve({ data: null, error: { message: "timeout" } });
        if (table === "group_memberships") return resolve(opts.failMemberships ? { data: null, error: { message: "timeout" } } : { data: opts.memberships, error: null });
        if (table === "organization_memberships") return resolve({ data: Array.from({ length: opts.orgRoles ?? 0 }, () => ({ organization_id: "o" })), error: null });
        if (table === "org_front_desk") return resolve({ data: Array.from({ length: opts.frontDesk ?? 0 }, () => ({ organization_id: "o" })), error: null });
        return resolve({ data: [], error: null });
      },
    };
    return b;
  };
  return { from: builder, rpc: async () => ({ data: { state: opts.guardian ?? "none" }, error: null }) } as never;
}
const client = [{ group_id: "g", role: "athlete" }];

describe("the age gate cannot be passed by a failed lookup or by having no seat", () => {
  it("a failed seat lookup is not ok and not remembered", async () => {
    const f = await loadDobGate(fake({ memberships: [], failMemberships: true }), "u");
    expect(f.gate).toBe("check_failed");
    expect(f.cacheable).toBe(false);
  });

  it("a person with no seat at all passes the page but is NOT remembered (a removed client put back within the week would otherwise skip the check)", async () => {
    const f = await loadDobGate(fake({ memberships: [] }), "u");
    expect(f).toMatchObject({ gate: "ok", cacheable: false });
  });

  it("only an adult client with a birthday on file, or a coach, is remembered; a coach who is also a client is a coach", async () => {
    expect((await loadDobGate(fake({ memberships: client, dob: "1990-04-01" }), "u")).cacheable).toBe(true);
    expect((await loadDobGate(fake({ memberships: [{ group_id: "g", role: "coach" }] }), "u")).cacheable).toBe(true);
    expect((await loadDobGate(fake({ memberships: [{ group_id: "g", role: "coach" }, { group_id: "h", role: "athlete" }], dob: null }), "u")).gate).toBe("ok");
    expect((await loadDobGate(fake({ memberships: client, dob: null }), "u")).cacheable).toBe(false);
    expect((await loadDobGate(fake({ memberships: client, dob: teenDob, guardian: "signed" }), "u")).cacheable).toBe(false);
    expect((await loadDobGate(fake({ memberships: client, dob: childDob }), "u")).gate).toBe("blocked");
  });
});

describe("a failed read of the date is a failed check, not a missing date", () => {
  function failing(table: string) {
    const builder = (t: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        limit: () => b,
        maybeSingle: async () => (t === table ? { data: null, error: { message: "timeout" } } : { data: null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(t === "group_memberships" ? { data: client, error: null } : { data: [], error: null }),
      };
      return b;
    };
    return { from: builder, rpc: async () => ({ data: { state: "none" }, error: null }) } as never;
  }
  it("a failed read of client_intake or athlete_profile_details is check_failed and never remembered", async () => {
    for (const table of ["client_intake", "athlete_profile_details"]) {
      const f = await loadDobGate(failing(table), "u");
      expect(f.gate, table).toBe("check_failed");
      expect(f.cacheable, table).toBe(false);
    }
  });
});

describe("staff are not client-only just because their only group seat is an athlete seat", () => {
  it("an organization owner or admin who also trains as a client, with no birthday on file, is ok (the staff screens and their API calls work)", async () => {
    const f = await loadDobGate(fake({ memberships: client, dob: null, orgRoles: 1 }), "u");
    expect(f.gate).toBe("ok");
    expect(f.cacheable).toBe(false);
  });

  it("a front-desk person with only an athlete seat is ok too", async () => {
    expect((await loadDobGate(fake({ memberships: client, dob: null, frontDesk: 1 }), "u")).gate).toBe("ok");
  });

  it("a plain client with no organization role and no front-desk seat is still asked for the birthday, and a child is still blocked", async () => {
    expect((await loadDobGate(fake({ memberships: client, dob: null }), "u")).gate).toBe("need_dob");
    expect((await loadDobGate(fake({ memberships: client, dob: childDob }), "u")).gate).toBe("blocked");
  });

  it("a failed staff lookup is a failed check, never a pass", async () => {
    for (const failTable of ["organization_memberships", "org_front_desk"]) expect((await loadDobGate(fake({ memberships: client, dob: null, failTable }), "u")).gate, failTable).toBe("check_failed");
  });

  it("the staff lookup only happens when it could matter (an athlete seat and no coach seat)", async () => {
    const coach = await loadDobGate(fake({ memberships: [{ group_id: "g", role: "coach" }], failTable: "organization_memberships" }), "u");
    expect(coach.gate).toBe("ok");
  });
});

describe("the intake gate is only for a person who is a client and nothing else", () => {
  it("a client-only account is gated; a coach, a coach who is also a client and a person with no seat are not", () => {
    expect(intakeGateApplies([{ role: "athlete" }])).toBe(true);
    expect(intakeGateApplies([{ role: "athlete" }, { role: "coach" }])).toBe(false);
    expect(intakeGateApplies([{ role: "coach" }])).toBe(false);
    expect(intakeGateApplies([])).toBe(false);
  });

  it("the middleware asks for the seats before it sends anyone to /intake", () => {
    const mw = src("lib/supabase/middleware.ts");
    const gate = mw.indexOf("intakeGateApplies((seats ?? [])");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(mw.indexOf('new URL("/intake", request.url)'));
  });
});

describe("one shared guard closes the API to a blocked child, and the page list covers the client's pages", () => {
  it("every /api route is covered except the listed ones a child must still reach", () => {
    for (const p of ["/api/ai/parse-food-log", "/api/push/subscribe", "/api/oura/connect", "/api/stripe/checkout", "/api/messages/thread", "/api/progress-look", "/api/assistant/action", "/api/series", "/api/nutrition/plan-retry", "/api/sms/consent", "/api/share/sign"]) expect(apiGateApplies(p), p).toBe(true);
    for (const p of ["/api/account/export", "/api/account/delete", "/api/guardian-consent/sign", "/api/guardian-consent/request", "/api/intake/submit", "/api/legal/accept", "/api/auth/forgot-password", "/api/feedback", "/api/push/unsubscribe", "/api/health", "/api/cron/purge-removed-clients", "/api/stripe/webhook", "/api/public-booking/x/book"]) expect(apiGateApplies(p), p).toBe(false);
    expect(apiGateApplies("/groups/x")).toBe(false);
    // a prefix that merely starts with an exempt word is not exempt
    expect(apiGateApplies("/api/healthcheck-other")).toBe(true);
    expect(apiGateApplies("/api/feedbackx")).toBe(true);
    expect(apiGateApplies("/api/accountx")).toBe(true);
    expect(apiGateApplies("/api/legalx")).toBe(true);
    expect(apiGateApplies("/api/healthz")).toBe(true);
    expect(apiGateApplies("/api/feedback")).toBe(false);
    expect(apiGateApplies("/api/feedback/thread")).toBe(false);
    expect(apiGateApplies("/api/health")).toBe(false);
    expect(apiGateApplies("/api/push/unsubscribe-all")).toBe(true);
    expect(API_GATE_EXEMPT_PREFIXES.length).toBeLessThan(25);
  });

  it("the client's own pages are gated, not only /groups, /sessions and /intake", () => {
    for (const p of ["/groups/g", "/sessions", "/my-training", "/my-training/open", "/my-space", "/partners", "/notifications", "/your-coaches", "/dashboard"]) expect(dobGatedPage(p), p).toBe(true);
    for (const p of ["/birthday", "/login", "/privacy", "/help", "/guardian/abc", "/groupsx"]) expect(dobGatedPage(p), p).toBe(false);
  });

  it("the middleware answers a blocked child's API call with 403 (or 503 when the check failed) and remembers nothing", () => {
    const mw = src("lib/supabase/middleware.ts");
    expect(mw).toContain("const gatedApi = apiGateApplies(pathname);");
    expect(mw).toContain('status: action === "unavailable" ? 503 : 403');
    expect(mw).toContain("(await mayRememberPass(facts)) ? await signDobOk");
  });
});

describe("the blocked and guardian screens say what to do about a wrong birthday", () => {
  it("both name the coach and support, before any failed save", () => {
    expect(src("app/birthday/page.tsx")).toContain("ask {coachName ?? \"your coach\"} to contact support");
    expect(src("components/intake/birthday-form.tsx")).toContain("If the date you entered is wrong, ask {coachName ?? \"your coach\"} to contact support.");
  });

  it("a failed check has its own screen with a way to try again, and the intake route says so too", () => {
    const page = src("app/birthday/page.tsx");
    expect(page.indexOf('facts.gate === "check_failed"')).toBeLessThan(page.indexOf("redirect(next)"));
    expect(src("app/api/intake/submit/route.ts")).toContain('facts.gate === "check_failed"');
  });
});

import { gateAction } from "./gate-paths";

describe("what the middleware does at a gate (the one decision function it calls)", () => {
  it("a page sends everyone who is not ok to the birthday screen, except a client still giving a date on the health form", () => {
    for (const gate of ["need_dob", "blocked", "need_guardian", "check_failed"] as const) expect(gateAction({ kind: "page", gate }), gate).toBe("redirect_birthday");
    expect(gateAction({ kind: "page", gate: "need_dob", onIntake: true })).toBe("pass");
    expect(gateAction({ kind: "page", gate: "blocked", onIntake: true })).toBe("redirect_birthday");
    expect(gateAction({ kind: "page", gate: "ok" })).toBe("pass");
  });

  it("the API is closed to anyone who is not ok: a known minor and an unknown age are 403 (unknown counts as a non-adult), a failed check is 503", () => {
    expect(gateAction({ kind: "api", gate: "blocked" })).toBe("forbidden");
    expect(gateAction({ kind: "api", gate: "need_guardian" })).toBe("forbidden");
    expect(gateAction({ kind: "api", gate: "need_dob" })).toBe("forbidden");
    expect(gateAction({ kind: "api", gate: "check_failed" })).toBe("unavailable");
    expect(gateAction({ kind: "api", gate: "ok" })).toBe("pass");
  });

  it("the claim step works for a client with a seat and no birthday ONLY because it is on the exempt list (by exact path)", () => {
    expect(apiGateApplies("/api/clients/complete-claim")).toBe(false);
    expect(apiGateApplies("/api/clients/complete-claimx")).toBe(true);
    expect(apiGateApplies("/api/clients/complete-claim/other")).toBe(false);
    expect(gateAction({ kind: "api", gate: "need_dob" })).toBe("forbidden");
    expect(src("lib/supabase/middleware.ts")).toContain("gateAction({ kind: gatedApi ? \"api\" : \"page\", gate: facts.gate, onIntake })");
  });
});

describe("what may skip the lookup, and who is given a pass", () => {
  const secret = "secret";
  it("only the week-long pass, signed for this person and this secret, skips the lookup; another person's, a forged, a missing one and no secret do not", async () => {
    const pass = (await signDobOk("u1", secret))!;
    expect(await maySkipGateCheck(pass, "u1", secret)).toBe(true);
    expect(await maySkipGateCheck(pass, "u2", secret)).toBe(false);
    expect(await maySkipGateCheck(pass, "u1", "other")).toBe(false);
    expect(await maySkipGateCheck(undefined, "u1", secret)).toBe(false);
    expect(await maySkipGateCheck(pass, "u1", undefined)).toBe(false);
    expect(await maySkipGateCheck("u1.deadbeef", "u1", secret)).toBe(false);
  });

  it("a pass is given only for an ok check that may be remembered: an adult client with a birthday on file or a coach; never to someone with no seat, a client without a date, a teen, a child or after a failed lookup", async () => {
    const outcome = async (opts: Parameters<typeof fake>[0]) => mayRememberPass(await loadDobGate(fake(opts), "u"));
    expect(await outcome({ memberships: client, dob: "1990-04-01" })).toBe(true);
    expect(await outcome({ memberships: [{ group_id: "g", role: "coach" }] })).toBe(true);
    expect(await outcome({ memberships: [] })).toBe(false);
    expect(await outcome({ memberships: client, dob: null })).toBe(false);
    expect(await outcome({ memberships: client, dob: teenDob, guardian: "signed" })).toBe(false);
    expect(await outcome({ memberships: client, dob: childDob })).toBe(false);
    expect(await outcome({ memberships: [], failMemberships: true })).toBe(false);
  });

  it("the middleware uses exactly these two decisions and keeps no other pass", () => {
    const mw = src("lib/supabase/middleware.ts");
    expect(mw).toContain("maySkipGateCheck(request.cookies.get(DOB_OK_COOKIE)?.value, user.id, process.env.CRON_SECRET)");
    expect(mw).toContain("(await mayRememberPass(facts))");
    expect(mw.toLowerCase()).not.toContain("noseat");
  });
});
