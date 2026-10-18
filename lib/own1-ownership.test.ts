import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isUnaccepted, unacceptedIds } from "@/lib/coach-invite-server";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const admin = (users: Record<string, any>) => ({
  auth: {
    admin: {
      getUserById: async (id: string) => {
        const u = users[id];
        if (u === "throw") throw new Error("boom");
        if (u === "error") return { data: null, error: { message: "boom" } };
        return { data: { user: u ?? null }, error: null };
      },
    },
  },
});

describe("OWN1: who counts as not having accepted", () => {
  it("is the same rule as the Invitations list: our marker on the account, never confirmed, never signed in", () => {
    expect(isUnaccepted({ invited_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(isUnaccepted({ invited_at: "2026-10-01T00:00:00Z", email_confirmed_at: "2026-10-02T00:00:00Z" })).toBe(false);
    expect(isUnaccepted({ invited_at: "2026-10-01T00:00:00Z", last_sign_in_at: "2026-10-02T00:00:00Z" })).toBe(false);
    expect(isUnaccepted({})).toBe(false);
    expect(isUnaccepted(null)).toBe(false);
  });

  it("finds the ones who have not accepted, and treats an account it cannot read as NOT accepted (never assumed fine for a decision about ownership)", async () => {
    const db = admin({
      a: { id: "a", invited_at: "2026-10-01T00:00:00Z" },
      b: { id: "b", invited_at: "2026-10-01T00:00:00Z", last_sign_in_at: "2026-10-02T00:00:00Z" },
      c: { id: "c" },
      d: "error",
      e: "throw",
      // f has no account at all
    });
    const got = await unacceptedIds(db, ["a", "b", "c", "d", "e", "f"]);
    expect(Array.from(got).sort()).toEqual(["a", "d", "e", "f"]);
    expect((await unacceptedIds(db, [])).size).toBe(0);
  });
});

describe("OWN1: the database and the screen", () => {
  it("the function refuses an unaccepted invitee with the plain words, for everyone but the server key, and keeps the older rules", () => {
    const m = src("supabase/migrations/0420_transfer_ownership_accepted_only.sql");
    expect(m).toContain("That person has not accepted their invitation yet. Ask them to sign in first.");
    expect(m).toContain("coalesce(auth.role(), '') <> 'service_role' and exists (");
    expect(m).toContain("u.invited_at is not null and u.email_confirmed_at is null and u.last_sign_in_at is null");
    for (const old of ["Only the current owner or a platform admin can transfer ownership", "That person already owns this organization", "The new owner must already be a member of this organization", "That coach is leaving this organization and cannot be made its owner."]) expect(m, old).toContain(old);
    expect(m).toContain("set role = 'admin'");
  });

  it("the Team page leaves unaccepted people out of the list, and says what to do when that leaves nobody", () => {
    const page = src("app/(coach)/groups/[groupId]/branding/page.tsx");
    expect(page).toContain("unacceptedIds(createServiceRoleClient()");
    expect(page).toContain("candidates={transferPool.filter((m) => !waiting.has(m.profileId))");
    expect(page).toContain("waitingOnInvitation={waiting.size}");
    const button = src("components/coach/desktop/transfer-ownership-button.tsx");
    expect(button).toContain("You can transfer ownership once a coach has accepted their invitation.");
    expect(button).toContain("if (waitingOnInvitation === 0) return null;");
  });
});
