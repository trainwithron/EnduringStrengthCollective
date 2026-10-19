import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadUnclaimedClient } from "@/lib/client-claim-server";
import { hostResolvesPublic, isPrivateAddress } from "@/lib/webhook-url";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// A stand-in for the two database clients loadUnclaimedClient uses.
function fakes({ claimedAt = null as string | null, lastSignIn = null as string | null, email = null as string | null, callerRole = "coach", memberRole = "athlete" } = {}) {
  const table = (rows: Record<string, unknown>) => {
    const q: any = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: rows }) };
    return q;
  };
  const supabase: any = { from: () => table({ role: callerRole }) };
  const serviceRole: any = {
    from: (name: string) => (name === "profiles" ? table({ full_name: "Sam", claimed_at: claimedAt }) : table({ role: memberRole })),
    auth: { admin: { getUserById: async () => ({ data: { user: { last_sign_in_at: lastSignIn, email } } }) } },
  };
  return { supabase, serviceRole };
}

describe("a coach can only touch the account of a client who has never signed in", () => {
  it("a client who has never signed in is fine", async () => {
    const { supabase, serviceRole } = fakes();
    expect(await loadUnclaimedClient(supabase, serviceRole, "coach", "g", "a")).toEqual({ ok: true, fullName: "Sam" });
  });
  it("a client who signed in some other way (no claimed stamp, but a sign-in on record and a real email) is refused", async () => {
    const { supabase, serviceRole } = fakes({ lastSignIn: "2026-10-01T10:00:00Z", email: "sam@example.com" });
    const r = await loadUnclaimedClient(supabase, serviceRole, "coach", "g", "a");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
  it("a claimed client is still refused, and a non-coach is refused first", async () => {
    expect(await loadUnclaimedClient(...(Object.values(fakes({ claimedAt: "2026-10-01" })) as [any, any]), "coach", "g", "a")).toMatchObject({ ok: false, status: 409 });
    const f = fakes({ callerRole: "athlete" });
    expect(await loadUnclaimedClient(f.supabase, f.serviceRole, "x", "g", "a")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("a webhook name must resolve to public addresses only", () => {
  it("private, loopback, link-local, unique-local and mapped addresses are private; ordinary ones are not", () => {
    for (const a of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.4.1", "192.168.1.9", "100.64.0.1", "::1", "fd12:3456::1", "fe80::1", "::ffff:10.1.2.3", "::"]) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("checks every address a name resolves to, and fails closed on an error or an empty answer", async () => {
    expect(await hostResolvesPublic("https://hooks.example.com/x", async () => ["93.184.216.34"])).toBe(true);
    expect(await hostResolvesPublic("https://hooks.example.com/x", async () => ["93.184.216.34", "10.0.0.8"])).toBe(false);
    expect(await hostResolvesPublic("https://hooks.example.com/x", async () => [])).toBe(false);
    expect(await hostResolvesPublic("https://hooks.example.com/x", async () => { throw new Error("nxdomain"); })).toBe(false);
    expect(await hostResolvesPublic("not a url", async () => ["8.8.8.8"])).toBe(false);
  });
  it("the delivery uses it", () => {
    expect(src("lib/webhook-dispatch.ts")).toContain("hostResolvesPublic(params.targetUrl");
  });
});

describe("the organization owner is not alerted about a private client, and a client on hold gets no text alert", () => {
  it("both low-balance routes skip the owner for a private client", () => {
    // the push now comes from the hourly digest job, which leaves the owner out of a client who is private from the organization
    expect(src("app/api/cron/low-session-digest/route.ts")).toContain("!privateSeat.has(`${gid}:${athleteId}`)");
    const sms = src("app/api/sms/low-credit-alert/route.ts");
    expect(sms).toContain("!(athleteMember as { private_from_org?: boolean }).private_from_org");
    expect(sms).toContain('reason: "payment_hold"');
  });
});

describe("the closure migrations say what they do", () => {
  it("0383: a STOP is remembered per number and blocks opt-in and dispatch", () => {
    const sql = src("supabase/migrations/0383_sms_number_suppression.sql");
    expect(sql).toContain("create table if not exists public.sms_suppressed_numbers");
    expect(sql).toContain("insert into public.sms_suppressed_numbers (phone_e164, stopped_at) values (p_phone, now())");
    expect(sql).toContain("delete from public.sms_suppressed_numbers where phone_e164 = p_phone");
    expect(sql).toContain("That number replied STOP");
  });
  it("0384: reference lists are owner-only, private clients stay private, ten tables get the in-group rule, changes are audited", () => {
    const sql = src("supabase/migrations/0384_privacy_closures.sql");
    for (const piece of ["builtin_ingredient_usda_mappings_update_own", "exercise_biomech_tags_delete_own", "is_group_private_from_org", "client_inactive_select_coach", "set_client_inactive", "reinstate_expired_credits", "enforce_athlete_in_group", "storage_path like", "organizations_audit", "legal_acceptances_audit"]) {
      expect(sql, piece).toContain(piece);
    }
    // secrets are never written to the audit trail
    expect(sql).not.toMatch(/pin_hash|api_key_hash/);
  });
});
