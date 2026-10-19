import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { everSignedIn } from "@/lib/ever-signed-in";
import { loadUnclaimedClient } from "@/lib/client-claim-server";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit item 17: Glen K. and Max A. opened their claim link but never finished; the coach's "Send the link" buttons said "They've already signed in" while only Resend worked.
describe("has this person signed in, so the account is theirs", () => {
  it("claimed: yes", () => {
    expect(everSignedIn({ claimedAt: "2026-10-01T00:00:00Z", lastSignInAt: null, email: null })).toBe(true);
  });
  it("a sign-in with a real email: yes", () => {
    expect(everSignedIn({ claimedAt: null, lastSignInAt: "2026-10-10T00:00:00Z", email: "glen@example.com" })).toBe(true);
  });
  it("a sign-in but only a placeholder address (partway through the claim): no, they still need their link", () => {
    expect(everSignedIn({ claimedAt: null, lastSignInAt: "2026-10-10T00:00:00Z", email: "client-abc123@pending.invalid" })).toBe(false);
    expect(everSignedIn({ claimedAt: null, lastSignInAt: "2026-10-10T00:00:00Z", email: null })).toBe(false);
  });
  it("never signed in: no", () => {
    expect(everSignedIn({ claimedAt: null, lastSignInAt: null, email: "x@example.com" })).toBe(false);
  });
});

describe("the coach's sign-in buttons and Resend use the same rule", () => {
  it("both import it", () => {
    expect(read("lib/client-claim-server.ts")).toContain("everSignedIn({ claimedAt: null, lastSignInAt: authUser?.user?.last_sign_in_at, email: authUser?.user?.email })");
    expect(read("lib/resend-access.ts")).toContain("everSignedIn({ claimedAt: profile.claimed_at, lastSignInAt: authUser?.last_sign_in_at, email })");
  });
  function fake(opts: { claimedAt?: string | null; lastSignInAt?: string | null; email?: string | null }) {
    const chain = (data: unknown): any => ({ select: () => chain(data), eq: () => chain(data), maybeSingle: async () => ({ data }) });
    const supabase: any = { from: () => chain({ role: "coach" }) };
    const serviceRole: any = {
      from: (t: string) => (t === "profiles" ? chain({ full_name: "Glen K.", claimed_at: opts.claimedAt ?? null }) : chain({ role: "athlete" })),
      auth: { admin: { getUserById: async () => ({ data: { user: { last_sign_in_at: opts.lastSignInAt ?? null, email: opts.email ?? null } } }) } },
    };
    return { supabase, serviceRole };
  }
  it("a mid-claim client (signed in once, placeholder address) can be given a link", async () => {
    const f = fake({ lastSignInAt: "2026-10-17T00:00:00Z", email: "client-glen@pending.invalid" });
    const r = await loadUnclaimedClient(f.supabase, f.serviceRole, "coach", "g", "athlete");
    expect(r.ok).toBe(true);
  });
  it("a client who really has signed in is still refused", async () => {
    const f = fake({ lastSignInAt: "2026-10-17T00:00:00Z", email: "glen@example.com" });
    const r = await loadUnclaimedClient(f.supabase, f.serviceRole, "coach", "g", "athlete");
    expect(r.ok).toBe(false);
    expect((r as { status: number }).status).toBe(409);
  });
});
