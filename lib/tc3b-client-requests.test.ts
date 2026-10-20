import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "visitor-1" } as { id: string } | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcAnswer: { data: { ok: true, id: "req-1" }, error: null } as { data: unknown; error: { message: string } | null },
  limited: false,
  // the public pages (service role)
  page: { coach_id: "coach-1", slug: "coach-ron", enabled: true } as Record<string, unknown> | null,
  switchRow: { accepts_requests: true } as Record<string, unknown> | null,
  switchError: null as unknown,
  org: "org-1" as string | null,
  real: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return state.rpcAnswer;
    },
  }),
}));
vi.mock("@/lib/rate-limit", async () => {
  const { NextResponse } = await import("next/server");
  return {
    clientIp: () => "1.2.3.4",
    rateLimitAllows: async () => !state.limited,
    rateLimitResponse: async () => (state.limited ? NextResponse.json({ error: "slow down" }, { status: 429 }) : null),
  };
});
vi.mock("@/lib/real-coach", () => ({ isRealCoach: async () => state.real }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => fakeDb(),
}));

function fakeDb() {
  let selecting = "";
  const chain: any = {
    select: (cols: string) => ((selecting = cols), chain),
    eq: () => chain,
    maybeSingle: async () => {
      if (selecting.includes("accepts_requests")) return { data: state.switchRow, error: state.switchError };
      if (selecting.includes("coach_id")) return { data: state.page, error: null };
      if (selecting.includes("full_name")) return { data: { full_name: "Coach Ron" }, error: null };
      return { data: null, error: null };
    },
  };
  return {
    from: () => chain,
    rpc: async (fn: string) => (fn === "client_request_org" ? { data: state.org, error: null } : { data: null, error: null }),
  };
}

import { canRequestOnPage, isRealCalendarDate, requestTargetFor } from "@/lib/client-requests";
import { POST as submit } from "@/app/api/client-requests/submit/route";
import { POST as answer } from "@/app/api/client-requests/answer/route";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  state.user = { id: "visitor-1" };
  state.rpcCalls = [];
  state.rpcAnswer = { data: { ok: true, id: "req-1" }, error: null };
  state.limited = false;
  state.page = { coach_id: "coach-1", slug: "coach-ron", enabled: true };
  state.switchRow = { accepts_requests: true };
  state.switchError = null;
  state.org = "org-1";
  state.real = true;
});

describe("when the Request to train with me button is offered", () => {
  it("only when the page is on, the switch is on and there is an organization for the request to go to", () => {
    expect(canRequestOnPage({ enabled: true, acceptsRequests: true, organizationId: "o" })).toBe(true);
    expect(canRequestOnPage({ enabled: false, acceptsRequests: true, organizationId: "o" })).toBe(false);
    expect(canRequestOnPage({ enabled: true, acceptsRequests: false, organizationId: "o" })).toBe(false);
    expect(canRequestOnPage({ enabled: true, acceptsRequests: true, organizationId: null })).toBe(false);
    expect(canRequestOnPage({ enabled: null, acceptsRequests: undefined, organizationId: undefined })).toBe(false);
  });

  it("looks the coach up by the page's address and shows nothing when any part is missing", async () => {
    expect(await requestTargetFor(fakeDb(), "Coach-Ron")).toEqual({ coachId: "coach-1", slug: "coach-ron", coachName: "Coach Ron" });
    state.page = { coach_id: "coach-1", slug: "coach-ron", enabled: false };
    expect(await requestTargetFor(fakeDb(), "coach-ron")).toBeNull();
    state.page = { coach_id: "coach-1", slug: "coach-ron", enabled: true };
    state.switchRow = { accepts_requests: false };
    expect(await requestTargetFor(fakeDb(), "coach-ron")).toBeNull();
    state.switchRow = { accepts_requests: true };
    state.org = null;
    expect(await requestTargetFor(fakeDb(), "coach-ron")).toBeNull();
    state.org = "org-1";
    state.real = false;
    expect(await requestTargetFor(fakeDb(), "coach-ron")).toBeNull();
    state.real = true;
    state.page = null;
    expect(await requestTargetFor(fakeDb(), "coach-ron")).toBeNull();
  });

  it("a database without the switch column yet shows no button instead of breaking the page", async () => {
    state.switchError = { message: 'column "accepts_requests" does not exist' };
    state.switchRow = null;
    expect(await requestTargetFor(fakeDb(), "coach-ron")).toBeNull();
  });

  it("a bad address never reaches the database", async () => {
    expect(await requestTargetFor(fakeDb(), "../etc/passwd")).toBeNull();
    expect(await requestTargetFor(fakeDb(), "")).toBeNull();
    expect(await requestTargetFor(fakeDb(), undefined)).toBeNull();
  });

  it("the public page shows the button only through that check, beside Book a consultation", () => {
    const page = read("app/c/[slug]/page.tsx");
    expect(page).toContain("requestTargetFor(db, slug)");
    expect(page).toContain("Request to train with me");
    expect(page).toContain("d.canRequest ?");
    expect(page).toContain("href={`/c/${d.slug}/request`}");
  });
});

describe("sending a request", () => {
  it("needs a signed-in person: signed out is a 401 and nothing is called", async () => {
    state.user = null;
    const res = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: "1990-01-01" }));
    expect(res.status).toBe(401);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("passes only who and the date of birth to the database; there is no message and no link anywhere", async () => {
    const res = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: "1990-01-01", message: "hello", token: "abc.def", coachId: "someone-else" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.rpcCalls).toEqual([{ fn: "submit_client_request", args: { p_coach: "coach-1", p_dob: "1990-01-01" } }]);
    const route = read("app/api/client-requests/submit/route.ts");
    expect(route).not.toMatch(/raw\??\.(message|token|link)/);
  });

  it("a date shaped like a date but not on the calendar is answered in plain words, never passed on to fail in the database", async () => {
    for (const bad of ["2020-13-45", "2021-02-30", "2019-00-10", "2020-04-31"]) {
      state.rpcCalls = [];
      const res = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: bad }));
      expect(res.status, bad).toBe(400);
      expect(await res.json(), bad).toEqual({ error: "That date of birth is not a real date.", code: "dob_invalid" });
      expect(state.rpcCalls, bad).toHaveLength(0);
    }
    expect(isRealCalendarDate("2020-02-29")).toBe(true);
    expect(isRealCalendarDate("2021-02-29")).toBe(false);
    expect(isRealCalendarDate("2000-12-31")).toBe(true);
    const ok = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: "2008-02-29" }));
    expect(ok.status).toBe(200);
  });

  it("a date that is not YYYY-MM-DD is dropped, not passed on", async () => {
    await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: "last tuesday" }));
    expect(state.rpcCalls[0].args.p_dob).toBeNull();
  });

  it("a page that is not taking requests is answered before the database is asked", async () => {
    state.switchRow = { accepts_requests: false };
    const res = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: null }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_taking");
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("the database's refusal comes through in its plain words with the right status", async () => {
    state.rpcAnswer = { data: { ok: false, code: "under_13", message: "Coaching here is for ages 13 and up. Ask a parent to contact the coach." }, error: null };
    let res = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: "2020-01-01" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Coaching here is for ages 13 and up. Ask a parent to contact the coach.", code: "under_13" });
    state.rpcAnswer = { data: { ok: false, code: "too_many", message: "Too many requests. Try again later." }, error: null };
    res = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: "1990-01-01" }));
    expect(res.status).toBe(429);
    state.rpcAnswer = { data: null, error: { message: "boom" } };
    res = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: "1990-01-01" }));
    expect(res.status).toBe(502);
  });

  it("is limited by pace", async () => {
    state.limited = true;
    const res = await submit(post("/api/client-requests/submit", { slug: "coach-ron", dob: "1990-01-01" }));
    expect(res.status).toBe(429);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("the coach answering", () => {
  const ID = "123e4567-e89b-42d3-a456-426614174000";
  it("needs a signed-in person", async () => {
    state.user = null;
    expect((await answer(post("/api/client-requests/answer", { id: ID, action: "approve" }))).status).toBe(401);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("approve and decline call the database function for that one request", async () => {
    state.rpcAnswer = { data: { ok: true, group_id: "g1", age_band: "adult" }, error: null };
    let res = await answer(post("/api/client-requests/answer", { id: ID, action: "approve" }));
    expect(await res.json()).toEqual({ ok: true, groupId: "g1", ageBand: "adult" });
    state.rpcAnswer = { data: null, error: null };
    res = await answer(post("/api/client-requests/answer", { id: ID, action: "decline" }));
    expect(res.status).toBe(200);
    expect(state.rpcCalls.map((c) => c.fn)).toEqual(["approve_client_request", "decline_client_request"]);
    expect((await answer(post("/api/client-requests/answer", { id: "not-an-id", action: "approve" }))).status).toBe(400);
  });

  it("an approval the database refuses is passed on in its words, with its code (a date of birth that needs support stays waiting)", async () => {
    state.rpcAnswer = { data: { ok: false, code: "dob_mismatch", message: "The date of birth on file ... contact support ... The request is still waiting." }, error: null };
    const body = await (await answer(post("/api/client-requests/answer", { id: ID, action: "approve" }))).json();
    expect(body).toMatchObject({ ok: false, code: "dob_mismatch" });
    expect(body.error).toContain("still waiting");
  });

  it("Decline all waiting is one call for the organization the coach names, and reports how many", async () => {
    state.rpcAnswer = { data: 7, error: null };
    const res = await answer(post("/api/client-requests/answer", { action: "decline_all", organizationId: "123e4567-e89b-42d3-a456-426614174111" }));
    expect(await res.json()).toEqual({ ok: true, declined: 7 });
    expect(state.rpcCalls).toEqual([{ fn: "decline_all_client_requests", args: { p_org: "123e4567-e89b-42d3-a456-426614174111" } }]);
    expect((await answer(post("/api/client-requests/answer", { action: "decline_all" }))).status).toBe(400);
  });
});

describe("the flow on the page", () => {
  const flow = read("components/client-request/request-flow.tsx");
  it("brings a new person back to the same request page after confirming their email, asks the date of birth only when none is on file, and ends on one plain line", () => {
    expect(flow).toContain("emailRedirectTo: `${window.location.origin}${here}`");
    expect(flow).toContain("const here = `/c/${slug}/request`;");
    expect(flow).toContain("needsDob &&");
    expect(flow).toContain("will get back to you.");
    expect(flow).not.toMatch(/<textarea|setMessage|const \[message|maxLength=\{300\}/);
  });
  it("sends only the page's address and the date", () => {
    expect(flow).toContain("JSON.stringify({ slug, dob: needsDob ? dob : null })");
  });
  it("the request page is read-only and an unavailable coach gets a plain notice", () => {
    const page = read("app/c/[slug]/request/page.tsx");
    expect(page).toContain("requestTargetFor(createServiceRoleClient(), slug)");
    expect(page).toContain("This coach isn&apos;t taking requests here");
    expect(page).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});

describe("the coach's side", () => {
  it("the switch is in Booking page settings, on by default, and says what it does", () => {
    const s = read("components/coach/desktop/booking-page-settings.tsx");
    expect(s).toContain("Let people request to train with me");
    expect(s).toContain("initial?.acceptsRequests ?? true");
    expect(s).toContain("accepts_requests: acceptsRequests");
    expect(read("app/(coach)/groups/[groupId]/business/booking-page/page.tsx")).toContain("accepts_requests !== false");
  });
  it("before approval the coach sees First L. and Approve / Decline only: nothing about age, no guardian note", () => {
    const panel = read("components/coach/client-requests-panel.tsx");
    expect(panel).not.toContain("Under 18");
    expect(panel).not.toContain("r.ageBand");
    expect(panel).not.toContain("If you accept");
    const page = read("app/(coach)/clients/requests/page.tsx");
    expect(page).not.toMatch(/age_band|ageBand/);
    // what to do next, including the guardian note, is said only after Approve
    expect(panel).toContain("NEXT_STEP[data.ageBand]");
  });
  it("the Requests page, the badge and the left-panel count cover ALL the coach's organizations, with the organization's name on each row when there are several", () => {
    const page = read("app/(coach)/clients/requests/page.tsx");
    expect(page).toContain('from("organization_memberships")');
    expect(page).toContain("organizationName: orgs.length > 1 ? org.name : null");
    expect(page).not.toContain("anchor.orgId");
    expect(read("app/(coach)/clients/page.tsx")).toContain("pendingRequestCount(supabase)");
    expect(read("app/(coach)/clients/page.tsx")).not.toContain("pendingRequestCount(supabase, anchor.orgId)");
    expect(read("app/(coach)/groups/[groupId]/clients/page.tsx")).toContain("pendingRequestCount(supabase)");
    expect(read("components/coach/desktop/pending-requests-line.tsx")).toContain('rpc("coach_client_request_count", { p_org: null })');
    // Decline all waiting covers every organization that has requests
    expect(read("components/coach/client-requests-panel.tsx")).toContain("new Set(requests.map((r) => r.organizationId))");
  });
  it("the Requests page lists only First L. (no photo, no message, no link), with Decline all waiting and a support contact for a date that needs correcting", () => {
    const panel = read("components/coach/client-requests-panel.tsx");
    expect(panel).toContain("Decline all waiting");
    expect(panel).toContain('href="/help"');
    expect(panel).toContain("supportEmail");
    expect(panel).not.toMatch(/avatar|<img|message\b.*textarea|Copy link|Make a new link/i);
    expect(read("app/(coach)/clients/requests/page.tsx")).toContain('rpc("coach_client_requests"');
  });
  it("the Requests count shows on the Clients pages (computer and phone) and in the left panel", () => {
    expect(read("app/(coach)/clients/page.tsx")).toContain("<RequestsLink count={requestCount} />");
    expect(read("app/(coach)/groups/[groupId]/clients/page.tsx")).toContain("<RequestsLink count={requestCount} />");
    expect(read("components/coach/desktop/shell-list-panel.tsx")).toContain("<PendingRequestsLine groupId={groupId} />");
  });
});

describe("the daily clean-up", () => {
  it("is a monitored daily job, scheduled, and added today", () => {
    expect(read("app/api/cron/purge-client-request-attempts/route.ts")).toContain('withCronRun("purge-client-request-attempts"');
    expect(read("lib/cron-jobs.ts")).toContain('{ job: "purge-client-request-attempts", path: "/api/cron/purge-client-request-attempts", maxAgeHours: DAILY }');
    // judged from when it went live (18:40 UTC Oct 19), not before its first chance to run
    expect(read("lib/cron-jobs.ts")).toContain('"purge-client-request-attempts": new Date("2026-10-19T18:40:00Z")');
    expect(read("vercel.json")).toContain('"path": "/api/cron/purge-client-request-attempts"');
  });
});

describe("the paths that must be open or closed", () => {
  it("the coach's public page is public already; no request route is public (each one needs a signed-in person)", () => {
    const mw = read("lib/supabase/middleware.ts");
    expect(mw).toContain('pathname.startsWith("/c/")');
    expect(mw).not.toContain("client-requests");
    for (const f of ["app/api/client-requests/submit/route.ts", "app/api/client-requests/answer/route.ts"]) expect(read(f), f).toContain("auth.getUser()");
  });
  it("a signed-in person who has not accepted the terms is not bounced off the coach's page", () => {
    expect(read("lib/legal-status.ts")).toContain('"/c"');
  });
});
