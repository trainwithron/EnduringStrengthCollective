import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GUARDIAN_PACKET_VERSION, ageBand, checkGuardianEmail, checkSignature, guardianPacketText, isUsState, majorityAgeFor, US_STATES } from "./guardian-consent";
import { hashToken, newToken } from "./guardian-consent-server";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-10-12T12:00:00");

describe("which clients need a guardian", () => {
  it("under 13 is not accepted, 13 to 17 needs a guardian, 18 and over is an adult, no date is unknown", () => {
    expect(ageBand("2018-01-05", NOW)).toBe("under13");
    expect(ageBand("2013-10-12", NOW)).toBe("teen"); // 13 today
    expect(ageBand("2013-10-13", NOW)).toBe("under13"); // 13 tomorrow
    expect(ageBand("2009-10-13", NOW)).toBe("teen"); // 17 until tomorrow
    expect(ageBand("2008-10-12", NOW)).toBe("adult"); // 18 today
    expect(ageBand(null, NOW)).toBe("unknown");
    expect(ageBand("not a date", NOW)).toBe("unknown");
  });

  it("the age of majority is 18 almost everywhere, 19 in Alabama and Nebraska, and Mississippi is treated as 21", () => {
    expect(majorityAgeFor("CA")).toBe(18);
    expect(majorityAgeFor("AL")).toBe(19);
    expect(majorityAgeFor("NE")).toBe(19);
    expect(majorityAgeFor("MS")).toBe(21);
    expect(US_STATES.length).toBe(51);
    expect(isUsState("TX")).toBe(true);
    expect(isUsState("ZZ")).toBe(false);
  });
});

describe("the guardian's address and signature", () => {
  it("must be a real address that is not the child's own", () => {
    expect(checkGuardianEmail(" Pat@Example.com ", "kid@example.com")).toEqual({ ok: true, email: "pat@example.com" });
    expect(checkGuardianEmail("kid@example.com", "KID@example.com")).toEqual({ ok: false, reason: "same_as_child" });
    for (const bad of ["", "nope", "a@b", "a b@c.com"]) expect(checkGuardianEmail(bad, null).ok, bad).toBe(false);
  });

  it("needs a name, a relationship from the list, a state and both boxes", () => {
    const ok = { name: "Pat Parent", relationship: "Parent", state: "TX", understood: true, mayRefuse: true };
    expect(checkSignature(ok)).toBeNull();
    expect(checkSignature({ ...ok, name: "P" })).toMatch(/full name/);
    expect(checkSignature({ ...ok, relationship: "Friend" })).toMatch(/relationship/);
    expect(checkSignature({ ...ok, state: "" })).toMatch(/state/);
    expect(checkSignature({ ...ok, understood: false })).toMatch(/read and understood/);
    expect(checkSignature({ ...ok, mayRefuse: false })).toMatch(/refuse/);
  });
});

describe("the words the guardian signs", () => {
  const text = guardianPacketText({ athleteName: "Sam Rivera", coachName: "Coach Dee", state: "TX" });

  it("is informed consent and an acknowledgment of risk, not a release: no waiver, release, indemnity or hold-harmless wording", () => {
    expect(text).not.toMatch(/waive|indemnif|hold harmless|hold-harmless|release you|release us|give up any claim/i);
    expect(text).toContain("THIS IS NOT A RELEASE");
    expect(text).toContain("does not give up any right");
  });

  it("says the guardian may refuse and that we may decline to coach the child, says how the health answers are used, and that permission can be withdrawn", () => {
    expect(text).toContain("You may refuse to sign. If you do not sign, we may decline to coach Sam Rivera.");
    expect(text).toContain("withdraw this permission at any time");
    expect(text).toContain("THE HEALTH QUESTIONS");
    expect(text).toContain("WITHOUT SEPARATE PERMISSION");
  });

  it("names the state's age of majority once the state is chosen, and every version is named and fingerprinted", () => {
    expect(guardianPacketText({ athleteName: "Sam", coachName: null, state: "AL" })).toContain("becomes an adult at 19");
    expect(guardianPacketText({ athleteName: "Sam", coachName: null, state: "MS" })).toContain("becomes an adult at 21");
    expect(guardianPacketText({ athleteName: "Sam", coachName: null, state: null })).toContain("19 in Alabama and Nebraska, 21 in Mississippi");
    expect(GUARDIAN_PACKET_VERSION).toMatch(/^guardian-consent-\d{4}-\d{2}$/);
    expect(createHash("sha256").update(text).digest("hex")).toHaveLength(64);
  });
});

describe("the one-time link", () => {
  it("is long and random, and only its hash is ever stored", () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(a)).toBe(createHash("sha256").update(a).digest("hex"));
    expect(hashToken(a)).not.toContain(a);
    const server = src("lib/guardian-consent-server.ts");
    expect(server).toContain("token_hash: hashToken(token)");
    expect(server).not.toMatch(/insert\(\{[^}]*token: token/);
  });
});

// ---- the signing route against a stand-in database
const db = vi.hoisted(() => ({
  row: null as null | { id: string; athlete_id: string; guardian_email: string; status: string; expires_at: string },
  updates: [] as Record<string, unknown>[],
  mails: [] as { to: string; subject: string; text: string }[],
  claimedBy: 0,
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null, clientIp: () => "203.0.113.9" }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail: async (to: string, subject: string, text: string) => (db.mails.push({ to, subject, text }), true) }));
vi.mock("@/lib/send-push", () => ({ sendPushToProfile: async () => 1 }));
vi.mock("@/lib/guardian-consent-server", async (orig) => {
  const real = await orig<typeof import("./guardian-consent-server")>();
  return { ...real, coachNameFor: async () => "Coach Dee" };
});
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const q: any = {
        _op: "select",
        select() { return q; }, eq() { return q; }, in() { return q; },
        update(values: Record<string, unknown>) { q._op = "update"; q._values = values; return q; },
        maybeSingle: async () => ({ data: table === "guardian_consents" ? db.row : table === "profiles" ? { full_name: "Sam Rivera" } : null }),
        then(resolve: (v: unknown) => void) {
          if (q._op === "update" && table === "guardian_consents") {
            db.updates.push(q._values);
            // the "still waiting" condition: only the first signature changes the row
            if (q._values.status === "signed") {
              const won = db.row?.status === "pending" && db.claimedBy === 0;
              if (won) {
                db.claimedBy++;
                db.row!.status = "signed";
              }
              resolve({ data: won ? [{ id: db.row!.id }] : [], error: null });
              return;
            }
          }
          resolve({ data: [], error: null });
        },
      };
      return q;
    },
  }),
}));

import { POST as sign } from "@/app/api/guardian-consent/sign/route";

const token = "t".repeat(43);
const body = { token, name: "Pat Parent", relationship: "Parent", state: "AL", understood: true, mayRefuse: true };
const post = (b: unknown, headers: Record<string, string> = {}) => sign(new Request("http://x/api/guardian-consent/sign", { method: "POST", headers, body: JSON.stringify(b) }));

beforeEach(() => {
  db.row = { id: "r1", athlete_id: "kid", guardian_email: "pat@example.com", status: "pending", expires_at: new Date(Date.now() + 86400000).toISOString() };
  db.updates = [];
  db.mails = [];
  db.claimedBy = 0;
});

describe("signing", () => {
  it("records the exact words, their fingerprint, the state's age of majority, the address and device, and emails the guardian a copy with how to withdraw", async () => {
    const res = await post(body, { "user-agent": "TestBrowser/1.0" });
    expect(res.status).toBe(200);
    const signedUpdate = db.updates.find((u) => u.status === "signed")!;
    expect(signedUpdate).toMatchObject({ guardian_name: "Pat Parent", relationship: "Parent", residence_state: "AL", majority_age: 19, doc_version: GUARDIAN_PACKET_VERSION, signed_ip: "203.0.113.9", signed_user_agent: "TestBrowser/1.0" });
    const words = guardianPacketText({ athleteName: "Sam Rivera", coachName: "Coach Dee", state: "AL" });
    expect(signedUpdate.doc_text).toBe(words);
    expect(signedUpdate.doc_sha256).toBe(createHash("sha256").update(words).digest("hex"));
    expect(db.mails.length).toBe(1);
    expect(db.mails[0].to).toBe("pat@example.com");
    expect(db.mails[0].text).toContain(words);
    expect(db.mails[0].text).toContain("Withdraw my permission");
    expect(db.mails[0].text).toContain(`/guardian-consent/${token}`);
  });

  it("signs once: a second tap at the same moment is refused and records nothing more", async () => {
    const first = await post(body);
    const second = await post(body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(db.mails.length).toBe(1);
  });

  it("refuses an expired or replaced link, a made-up link, and incomplete answers", async () => {
    db.row!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await post(body)).status).toBe(410);
    db.row!.expires_at = new Date(Date.now() + 86400000).toISOString();
    db.row!.status = "replaced";
    expect((await post(body)).status).toBe(410);
    db.row = null;
    expect((await post(body)).status).toBe(404);
    expect((await post({ ...body, token: "short" })).status).toBe(404);
    db.row = { id: "r1", athlete_id: "kid", guardian_email: "pat@example.com", status: "pending", expires_at: new Date(Date.now() + 86400000).toISOString() };
    expect((await post({ ...body, understood: false })).status).toBe(400);
    expect((await post({ ...body, state: "ZZ" })).status).toBe(400);
    expect(db.mails.length).toBe(0);
  });

  it("the child's own session plays no part: the route has no sign-in and takes nothing but the link and the guardian's answers", () => {
    const route = src("app/api/guardian-consent/sign/route.ts");
    expect(route).not.toContain("createServerClient");
    expect(route).not.toContain("auth.getUser");
  });
});

describe("how the gate is wired", () => {
  it("sends a client under 18 without permission back to the permission screen, covers the health form, and never remembers a minor's pass", () => {
    const mw = src("lib/supabase/middleware.ts");
    expect(mw).toContain('onIntake && facts.gate === "need_dob"');
    expect(mw).toContain('facts.ageBand === "teen" || facts.ageBand === "under13" ? null');
    for (const open of ['pathname.startsWith("/guardian-consent/")', 'pathname === "/api/guardian-consent/sign"', 'pathname === "/api/guardian-consent/withdraw"']) expect(mw).toContain(open);
    // the request and resend routes are NOT public: they need a signed-in child or coach
    expect(mw).not.toContain('"/api/guardian-consent/request"');
    expect(mw).not.toContain('"/api/guardian-consent/resend"');
  });

  it("the permission screen replaces the birthday step for a client aged 13 to 17 and the under-13 message no longer waits on a coach", () => {
    expect(src("app/birthday/page.tsx")).toContain('facts.gate === "need_guardian"');
    const form = src("components/intake/birthday-form.tsx");
    expect(form).toContain("Spotlight Coaching is for people 13 and older");
    expect(form).toContain("minor-consent-notice"); // the coach is still told why a child under 13 is not training
    expect(form).not.toContain("consentVerified");
  });

  it("the coach sees where permission stands and can resend; the old 'mark verified' control is gone", () => {
    const page = src("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("<GuardianConsentStatus");
    expect(page).not.toContain("<MinorConsentControl");
    expect(src("app/api/guardian-consent/resend/route.ts")).toContain("Only the client's coach can do that.");
  });

  it("the migration is a server-only table and one new function", () => {
    const sql = src("supabase/migrations/0402_guardian_consent.sql");
    expect(sql).toContain("revoke all on public.guardian_consents from anon, authenticated;");
    expect(sql).toContain("create unique index if not exists guardian_consents_one_signed");
    expect(sql).not.toMatch(/create or replace function public\.(?!guardian_consent_state)/);
  });
});
