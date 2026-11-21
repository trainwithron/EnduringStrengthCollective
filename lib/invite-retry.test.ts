// Send again / Copy link for an invitation whose email failed (desktop audit D24, review Nov 21): ONE route that works out on the server whether the id is a new address's person or an
// existing account's in-app invitation, and answers in exactly the same shape either way, so the inviter cannot tell which kind of address it was.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAVING_API } from "@/lib/workspace-mutation";

// a database where organization_invites holds the in-app invitation "inv-1" (an address that already had an account); anything else is not one
const db = {
  from: (table: string) => {
    let id = "";
    const q: any = {
      select: () => q,
      eq: (col: string, v: string) => {
        if (col === "id") id = v;
        return q;
      },
      maybeSingle: async () => {
        if (table === "organization_invites") return { data: id === "inv-1" ? { id: "inv-1", invited_profile_id: "p-existing", role: "coach", answered_at: null } : null, error: null };
        if (table === "organizations") return { data: { name: "Gym" }, error: null };
        return { data: null, error: null };
      },
    };
    return q;
  },
  rpc: vi.fn(async () => ({ data: null, error: null })),
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
};

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => db }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => db }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null, rateLimitAllows: async () => true }));
vi.mock("@/lib/app-url", () => ({ appOrigin: () => "https://app.test" }));
vi.mock("@/lib/auth-mail", () => ({ inviteEmail: () => ({ subject: "s", html: "h" }), sendAuthMail: vi.fn(async () => true) }));
vi.mock("@/lib/invite-notify", () => ({ notifyAndEmail: vi.fn(async () => ({ notified: true, emailed: true })) }));
vi.mock("@/lib/coach-join-link", () => ({ ensureJoinLink: async () => ({ ok: true, row: { id: "join-9", expires_at: "x" } }), joinLinkUrl: (o: string, id: string) => `${o}/join/${id}` }));
vi.mock("@/lib/coach-invite-server", () => ({
  authorizeInviteManager: async () => ({ ok: true, manager: { organizationId: "org-1", callerName: "Ron" } }),
  // "p-new" is a person waiting to accept (a new address); anything else is not
  loadInviteTarget: async (_db: unknown, _org: string, id: string) =>
    id === "p-new" ? { ok: true, email: "new@x.test", name: "New Coach", role: "coach", appMetadata: {} } : { ok: false, status: 404, error: "That invitation was not found." },
  markSent: vi.fn(async () => undefined),
}));

const call = async (unsentId: string, action: "resend" | "link") => {
  const { POST } = await import("@/app/api/coaches/invite/retry/route");
  const res = await POST(new Request("http://localhost/api/coaches/invite/retry", { method: "POST", body: JSON.stringify({ groupId: "g1", unsentId, action }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => vi.clearAllMocks());

describe("one route for both kinds", () => {
  it("Send again answers the same status and the same keys for a new address and for an existing account", async () => {
    const person = await call("p-new", "resend");
    const invite = await call("inv-1", "resend");
    expect(person.status).toBe(200);
    expect(invite.status).toBe(200);
    expect(Object.keys(person.body).sort()).toEqual(Object.keys(invite.body).sort());
    expect(person.body).toEqual({ ok: true, emailed: true });
    expect(invite.body).toEqual({ ok: true, emailed: true });
    // the in-app invitation went through the database's own extend (which checks the caller)
    expect(db.rpc).toHaveBeenCalledWith("extend_org_invite", { p_invite: "inv-1" });
  });
  it("Copy link answers the same status and the same keys for both kinds", async () => {
    const person = await call("p-new", "link");
    const invite = await call("inv-1", "link");
    expect(person.status).toBe(invite.status);
    expect(Object.keys(person.body).sort()).toEqual(Object.keys(invite.body).sort());
    expect(person.body).toEqual({ ok: true, link: "https://app.test/join/join-9" });
    expect(invite.body).toEqual({ ok: true, link: "https://app.test/org-invite/inv-1" });
  });
  it("an id that is neither gets one plain answer", async () => {
    const r = await call("nobody", "resend");
    expect(r.status).toBe(404);
    expect(Object.keys(r.body)).toEqual(["error"]);
  });
  it("is a save the other panes hear about, and the invite route hands back one key on every path", () => {
    expect(SAVING_API.test("/api/coaches/invite/retry")).toBe(true);
    const route = readFileSync(join(__dirname, "..", "app/api/coaches/invite/route.ts"), "utf8");
    expect(route.match(/unsentId:/g)?.length).toBe(3);
    expect(route).not.toMatch(/pendingProfileId|inviteId:/);
  });
});
