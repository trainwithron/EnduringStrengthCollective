import { describe, it, expect } from "vitest";
import { DOB_OK_COOKIE, dobOkCookieValid, loadDobGate, signDobOk } from "./dob-gate";

// The pass cookie: remembered only for an adult whose date of birth is on file (or someone who is not a client); a client with no date, a teen and a child are checked on every page; and passes issued before
// this rule existed stop working at the deploy.
async function oldFormatPass(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`dob_ok:${userId}`));
  return `${userId}.${Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

describe("the pass cookie", () => {
  it("has a new name, and a pass made the old way no longer opens anything", async () => {
    expect(DOB_OK_COOKIE).toBe("dob_ok_v2");
    const old = await oldFormatPass("user-1", "secret");
    expect(await dobOkCookieValid(old, "user-1", "secret")).toBe(false);
    const fresh = await signDobOk("user-1", "secret");
    expect(await dobOkCookieValid(fresh!, "user-1", "secret")).toBe(true);
    expect(fresh).not.toBe(old);
  });
});

// A stand-in database for one person.
function fake(opts: { memberships: { group_id: string; role: string }[]; dob: string | null; guardian?: string }) {
  const answer = (data: unknown) => ({ data, error: null });
  const builder = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      limit: () => b,
      maybeSingle: async () => answer(table === "client_intake" ? (opts.dob ? { date_of_birth: opts.dob } : null) : null),
      then: (resolve: (v: unknown) => void) => resolve(answer(table === "group_memberships" ? opts.memberships : [])),
    };
    return b;
  };
  return { from: builder, rpc: async () => answer({ state: opts.guardian ?? "none" }) } as never;
}
const clientOnly = [{ group_id: "g", role: "athlete" }];

describe("who may be remembered", () => {
  it("an adult client with a date on file may", async () => {
    const f = await loadDobGate(fake({ memberships: clientOnly, dob: "1990-04-01" }), "u");
    expect(f).toMatchObject({ gate: "ok", ageBand: "adult", cacheable: true });
  });

  it("a client who has not given a date yet is not remembered, so a birthday typed later is checked at once", async () => {
    const f = await loadDobGate(fake({ memberships: clientOnly, dob: null }), "u");
    expect(f).toMatchObject({ gate: "need_dob", cacheable: false });
  });

  it("a teen is never remembered, even with a guardian's permission", async () => {
    const teenDob = `${new Date().getFullYear() - 15}-01-01`;
    const signed = await loadDobGate(fake({ memberships: clientOnly, dob: teenDob, guardian: "signed" }), "u");
    expect(signed).toMatchObject({ gate: "ok", ageBand: "teen", cacheable: false });
    const unsigned = await loadDobGate(fake({ memberships: clientOnly, dob: teenDob }), "u");
    expect(unsigned).toMatchObject({ gate: "need_guardian", cacheable: false });
  });

  it("a child under 13 is blocked and never remembered", async () => {
    const f = await loadDobGate(fake({ memberships: clientOnly, dob: `${new Date().getFullYear() - 10}-01-01`, guardian: "signed" }), "u");
    expect(f).toMatchObject({ gate: "blocked", cacheable: false });
  });

  it("someone who is not a client (a coach) may be remembered", async () => {
    const f = await loadDobGate(fake({ memberships: [{ group_id: "g", role: "coach" }], dob: null }), "u");
    expect(f).toMatchObject({ gate: "ok", cacheable: true });
  });
});
