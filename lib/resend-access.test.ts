import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  emailConfigured: true,
  sentEmails: [] as { to: string; subject: string }[],
  resetCalls: [] as string[],
  resetError: null as { message: string } | null,
  allow: true,
  claimEmailed: true,
  minted: 0,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { resetPasswordForEmail: async (email: string) => { state.resetCalls.push(email); return { error: state.resetError }; } } }),
}));
vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => state.emailConfigured,
  sendEmail: async (to: string, subject: string) => { state.sentEmails.push({ to, subject }); return true; },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitAllows: async () => state.allow, rateLimitResponse: async () => null }));
vi.mock("@/lib/client-claim-server", () => ({ mintClaimLink: async () => { state.minted++; return { ok: true, link: "https://app.test/claim/abc", expiresAt: "2026-10-20T00:00:00Z" }; } }));
vi.mock("@/lib/claim-email", () => ({ emailClaimLink: async () => state.claimEmailed }));

import { resendAccess } from "./resend-access";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

function fakes(opts: { callerRole?: string; memberRole?: string | null; claimedAt?: string | null; email?: string | null; confirmed?: boolean; lastSignIn?: string | null; recentEmailChange?: boolean }) {
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: opts.callerRole ?? "coach" } }) }) }) }) }) };
  const serviceRole = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        limit: async () => ({ data: opts.recentEmailChange ? [{ id: "n1" }] : [] }),
        maybeSingle: async () => {
          if (table === "group_memberships") return { data: opts.memberRole === null ? null : { role: opts.memberRole ?? "athlete" } };
          return { data: { full_name: "Max Anthony", claimed_at: opts.claimedAt ?? null } };
        },
      };
      return q;
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: opts.email === undefined ? "max@example.com" : opts.email, email_confirmed_at: opts.confirmed === false ? null : "2026-10-10", last_sign_in_at: opts.lastSignIn ?? null } } }),
        generateLink: async () => ({ data: { properties: { action_link: "https://supabase.test/verify?x=1" } }, error: null }),
      },
    },
  };
  return { supabase, serviceRole };
}

const run = (opts: Parameters<typeof fakes>[0]) => {
  const { supabase, serviceRole } = fakes(opts);
  return resendAccess({ supabase, serviceRole, coachId: "c1", groupId: "g1", athleteId: "a1", origin: "https://app.test" });
};

beforeEach(() => {
  state.emailConfigured = true;
  state.sentEmails = [];
  state.resetCalls = [];
  state.resetError = null;
  state.allow = true;
  state.claimEmailed = true;
  state.minted = 0;
});

describe("resend invite / sign-in link", () => {
  it("a client who never signed in gets a fresh sign-in link by email, and the old one is replaced", async () => {
    const r = await run({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, kind: "claim_emailed" });
    expect(state.minted).toBe(1);
    expect((r.body as { message: string }).message).toContain("Any earlier link stopped working");
  });

  it("with no email address on file the coach is handed the link to copy or text, not refused", async () => {
    const r = await run({ email: "client-abc@pending.invalid" });
    expect(r.body).toMatchObject({ ok: true, kind: "claim_link", link: "https://app.test/claim/abc" });
    expect((r.body as { message: string }).message).toContain("no email address on file");
  });

  it("when email cannot be sent the link is handed over instead", async () => {
    state.emailConfigured = false;
    const r = await run({});
    expect(r.body).toMatchObject({ kind: "claim_link", link: "https://app.test/claim/abc" });
    state.emailConfigured = true;
    state.claimEmailed = false;
    expect((await run({})).body).toMatchObject({ kind: "claim_link" });
  });

  it("a client who has signed in (Max, last sign-in Oct 12) gets an email to their OWN address; the coach never sees a link", async () => {
    const r = await run({ claimedAt: "2026-10-12T00:00:00Z", lastSignIn: "2026-10-12T00:00:00Z" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, kind: "signin_emailed" });
    expect((r.body as { link?: string }).link).toBeUndefined();
    expect(state.resetCalls).toEqual(["max@example.com"]);
    expect(state.minted).toBe(0);
  });

  it("a signed-in client whose address was never confirmed still gets the email, sent by the platform", async () => {
    const r = await run({ lastSignIn: "2026-10-12T00:00:00Z", confirmed: false });
    expect(r.body).toMatchObject({ ok: true, kind: "signin_emailed" });
    expect(state.resetCalls).toEqual([]);
    expect(state.sentEmails).toHaveLength(1);
    expect(state.sentEmails[0].to).toBe("max@example.com");
  });

  it("a person who is already an account holder and already in the group is never refused for that", async () => {
    // the exact state of the bug: an account since Oct 10, already an athlete in the group, last sign-in Oct 12
    const r = await run({ claimedAt: null, lastSignIn: "2026-10-12T00:00:00Z", memberRole: "athlete" });
    expect(r.status).toBe(200);
  });

  it("the only waits are a minute between sends, and a day after the address was changed", async () => {
    state.allow = false;
    expect((await run({})).status).toBe(429);
    state.allow = true;
    const changed = await run({ lastSignIn: "2026-10-12T00:00:00Z", recentEmailChange: true });
    expect(changed.status).toBe(403);
    expect((changed.body as { error: string }).error).toContain("changed in the last 24 hours");
  });

  it("only this client's coach, and only for someone in the group", async () => {
    expect((await run({ callerRole: "athlete" })).status).toBe(403);
    expect((await run({ memberRole: null })).status).toBe(404);
    expect((await run({ memberRole: "coach" })).status).toBe(404);
  });

  it("a signed-in person with no real email gets a plain message and no guess", async () => {
    const r = await run({ lastSignIn: "2026-10-12T00:00:00Z", email: "client-abc@pending.invalid" });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toContain("Forgot password");
  });
});

describe("wiring", () => {
  it("adding someone who is already the coach's client resends instead of refusing (before the room check), and the client's profile always offers it", () => {
    const route = src("app/api/clients/invite/route.ts");
    expect(route.indexOf("resendAccess(")).toBeGreaterThan(-1);
    expect(route.indexOf("resendAccess(")).toBeLessThan(route.indexOf("checkOneOnOneGroupHasRoom("));
    const page = src("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect((page.match(/<SendSignInLinkButton/g) ?? []).length).toBe(2);
    expect(src("components/coach/send-signin-link-button.tsx")).toContain("/api/clients/resend-access");
    expect(src("components/coach/desktop/add-client-button.tsx")).toContain("data.resent");
  });
});
