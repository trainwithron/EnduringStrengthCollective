import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDobGate } from "./dob-gate";
import { API_GATE_EXEMPT_PREFIXES, apiGateApplies, dobGatedPage, intakeGateApplies } from "./gate-paths";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const teenDob = `${new Date().getFullYear() - 15}-01-01`;
const childDob = `${new Date().getFullYear() - 10}-01-01`;

// A stand-in database; any table can be made to fail.
function fake(opts: { memberships: { group_id: string; role: string }[]; dob?: string | null; guardian?: string; failMemberships?: boolean }) {
  const builder = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: table === "client_intake" && opts.dob ? { date_of_birth: opts.dob } : null, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve(table === "group_memberships" ? (opts.failMemberships ? { data: null, error: { message: "timeout" } } : { data: opts.memberships, error: null }) : { data: [], error: null }),
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
    expect(mw).toContain('status: facts.gate === "check_failed" ? 503 : 403');
    expect(mw).toContain("facts.cacheable ? await signDobOk");
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
