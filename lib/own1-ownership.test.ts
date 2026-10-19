import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isUnaccepted, notSignedInIds } from "@/lib/coach-invite-server";

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

  it("for ownership the rule is a real sign-in: a confirmed link is not enough, an account that cannot be read counts as not signed in", async () => {
    const db = admin({
      a: { id: "a", invited_at: "2026-10-01T00:00:00Z" },
      b: { id: "b", invited_at: "2026-10-01T00:00:00Z", last_sign_in_at: "2026-10-02T00:00:00Z" },
      c: { id: "c" },
      g: { id: "g", invited_at: "2026-10-01T00:00:00Z", email_confirmed_at: "2026-10-02T00:00:00Z" },
      h: { id: "h", last_sign_in_at: "2026-10-02T00:00:00Z" },
      d: "error",
      e: "throw",
      // f has no account at all
    });
    const got = await notSignedInIds(db, ["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(Array.from(got).sort()).toEqual(["a", "c", "d", "e", "f", "g"]);
    expect((await notSignedInIds(db, [])).size).toBe(0);
    // the Invitations list keeps its own, looser rule: a confirmed link counts as accepted there
    expect(isUnaccepted({ invited_at: "2026-10-01T00:00:00Z", email_confirmed_at: "2026-10-02T00:00:00Z" })).toBe(false);
  });
});

describe("OWN1: the database and the screen", () => {
  it("the function refuses someone who has never signed in with the plain words, for everyone but the server key, and keeps the older rules", () => {
    const m = src("supabase/migrations/0420_transfer_ownership_accepted_only.sql");
    expect(m).toContain("That person has not accepted their invitation yet. Ask them to sign in first.");
    expect(m).toContain("coalesce(auth.role(), '') <> 'service_role' and not exists (");
    expect(m).toContain("u.id = p_new_owner_id and u.last_sign_in_at is not null");
    expect(m).toContain("u.id = new.owner_id and u.last_sign_in_at is not null");
    expect(m).not.toContain("email_confirmed_at");
    for (const old of ["Only the current owner or a platform admin can transfer ownership", "That person already owns this organization", "The new owner must already be a member of this organization", "That coach is leaving this organization and cannot be made its owner."]) expect(m, old).toContain(old);
    expect(m).toContain("set role = 'admin'");
    // the same refusal at the table, and the membership guard
    expect(m).toContain("create or replace function public.guard_organization_columns()");
    expect(m.split("That person has not accepted their invitation yet. Ask them to sign in first.").length - 1).toBe(2);
    expect(m).toContain("create trigger organization_memberships_guard_owner_role");
    expect(m).toContain("Ownership is handed over with Transfer ownership, not by changing a role.");
  });

  it("the Team page leaves unaccepted people out of the list, and says what to do when that leaves nobody", () => {
    const page = src("app/(coach)/groups/[groupId]/branding/page.tsx");
    expect(page).toContain("notSignedInIds(createServiceRoleClient()");
    expect(page).toContain("candidates={transferPool.filter((m) => !waiting.has(m.profileId))");
    expect(page).toContain("waitingOnInvitation={waiting.size}");
    // the lookups are only made on the Team tab, where the list is shown
    expect(page).toContain('isOwner && tab === "team" && transferPool.length > 0');
    const button = src("components/coach/desktop/transfer-ownership-button.tsx");
    expect(button).toContain("You can transfer ownership once a coach has accepted their invitation and signed in.");
    expect(button).toContain("if (waitingOnInvitation === 0) return null;");
  });
});
