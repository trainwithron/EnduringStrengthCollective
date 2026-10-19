import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  users: {} as Record<string, Record<string, unknown>>,
  generated: [] as { type: string; email: string }[],
  updated: [] as { id: string; app_metadata: Record<string, unknown> }[],
  mails: [] as { to: string; subject: string; text: string }[],
  mailOk: true,
}));

function table(name: string) {
  let rows = [...(state.tables[name] ?? [])];
  const b: any = {
    select: () => b,
    eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), b),
    is: (col: string) => ((rows = rows.filter((r) => r[col] == null)), b),
    gt: (col: string, val: string) => ((rows = rows.filter((r) => String(r[col]) > val)), b),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null, count: rows.length }),
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: (t: string) => table(t) }) }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => table(t),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: state.users[id] ? { id, ...state.users[id] } : null } }),
        updateUserById: async (id: string, attrs: { app_metadata: Record<string, unknown> }) => (state.updated.push({ id, app_metadata: attrs.app_metadata }), { error: null }),
        generateLink: async (a: { type: string; email: string }) => (state.generated.push({ type: a.type, email: a.email }), { data: { properties: { action_link: `https://auth.example/${a.type}?token=SECRET` }, user: { id: "x" } }, error: null }),
      },
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => true,
  sendEmail: async (to: string, subject: string, text: string) => (state.mails.push({ to, subject, text }), state.mailOk),
}));

import { POST as signin } from "@/app/api/coaches/invite/signin/route";
import { inviteLinkProbablyDead, shortDate, signInFacts, signInWords } from "@/lib/coach-invite-server";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const G = "group-1";
const ORG = "org-1";
const req = (body: unknown) => new Request("https://app.test/api/coaches/invite/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const long = "2026-10-01T10:00:00Z";

beforeEach(() => {
  state.user = { id: "admin-1" };
  state.generated = [];
  state.updated = [];
  state.mails = [];
  state.mailOk = true;
  state.users = {
    "admin-1": { email: "admin@x.co", email_confirmed_at: long, last_sign_in_at: long },
    kade: { email: "kade@x.co", email_confirmed_at: "2026-10-17T21:49:02Z", last_sign_in_at: "2026-10-17T21:49:02Z", invited_at: "2026-10-17T21:48:49Z", app_metadata: { invite_emailed_at: "2026-10-17T21:47:53Z", invite_link_made_at: "2026-10-17T21:48:49Z" } },
    fresh: { email: "fresh@x.co", email_confirmed_at: null, last_sign_in_at: null, invited_at: "2026-10-17T09:00:00Z", app_metadata: {} },
    never: { email: "never@x.co", email_confirmed_at: "2026-10-17T09:00:00Z", last_sign_in_at: null, invited_at: "2026-10-17T09:00:00Z", app_metadata: {} },
    owner: { email: "owner@x.co", email_confirmed_at: long, last_sign_in_at: long },
    stranger: { email: "stranger@x.co", email_confirmed_at: long, last_sign_in_at: long },
    elsewhere: { email: "else@x.co", email_confirmed_at: null, last_sign_in_at: null, invited_at: "2026-10-17T09:00:00Z", app_metadata: {} },
  };
  state.tables = {
    groups: [{ id: G, organization_id: ORG }],
    organization_memberships: [
      { organization_id: ORG, profile_id: "admin-1", role: "admin" },
      { organization_id: ORG, profile_id: "owner", role: "owner" },
      { organization_id: ORG, profile_id: "kade", role: "coach" },
      { organization_id: ORG, profile_id: "fresh", role: "coach" },
      { organization_id: ORG, profile_id: "never", role: "coach" },
      { organization_id: "org-2", profile_id: "stranger", role: "coach" },
      { organization_id: ORG, profile_id: "elsewhere", role: "coach" },
      { organization_id: "org-2", profile_id: "elsewhere", role: "coach" },
    ],
    org_front_desk: [],
    group_memberships: [],
    organization_invites: [],
    space_invites: [],
    client_invites: [],
    profiles: [
      { id: "admin-1", full_name: "Ron Arnold" },
      { id: "kade", full_name: "Kade Thompson" },
      { id: "fresh", full_name: "Fran Fresh" },
      { id: "never", full_name: "Nate Never" },
    ],
    organizations: [{ id: ORG, name: "Lee County West Trojans" }],
  };
});

describe("Send sign-in link", () => {
  it("a coach who has signed in gets a sign-in link in their OWN inbox, and the link is never shown to the admin", async () => {
    const res = await signin(req({ groupId: G, profileId: "kade" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, emailed: true, kind: "sign-in" });
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(JSON.stringify(body)).not.toContain("auth.example");
    expect(state.generated).toEqual([{ type: "recovery", email: "kade@x.co" }]);
    expect(state.mails).toHaveLength(1);
    expect(state.mails[0].to).toBe("kade@x.co");
    expect(state.mails[0].text).toContain("https://auth.example/recovery?token=SECRET");
    expect(state.mails[0].text).toContain("Ron Arnold sent you this link");
    // the ten-minute cooldown is written only after the send
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].app_metadata).toMatchObject({ signin_emailed_at: expect.any(String), invite_emailed_at: "2026-10-17T21:47:53Z" });
  });

  it("an account that has never signed in (a link opened without a sign-in) gets the same", async () => {
    const res = await signin(req({ groupId: G, profileId: "never" }));
    expect((await res.json()).kind).toBe("sign-in");
    expect(state.generated[0].type).toBe("recovery");
  });

  it("an invitation nobody has used is sent again as an invitation (a new link by email)", async () => {
    const res = await signin(req({ groupId: G, profileId: "fresh" }));
    expect(await res.json()).toMatchObject({ ok: true, emailed: true, kind: "invitation" });
    expect(state.generated).toEqual([{ type: "invite", email: "fresh@x.co" }]);
    expect(state.mails[0].subject).toBe("Lee County West Trojans invited you to join");
    expect(state.updated[0].app_metadata).toHaveProperty("invite_emailed_at");
  });

  it("once in ten minutes: a second press sends nothing", async () => {
    state.users.kade.app_metadata = { signin_emailed_at: new Date().toISOString() };
    const res = await signin(req({ groupId: G, profileId: "kade" }));
    expect(res.status).toBe(429);
    expect(state.generated).toHaveLength(0);
    expect(state.mails).toHaveLength(0);
  });

  it("a send that did not go out is said plainly and does not start the cooldown", async () => {
    state.mailOk = false;
    const res = await signin(req({ groupId: G, profileId: "kade" }));
    expect((await res.json()).emailed).toBe(false);
    expect(state.updated).toHaveLength(0);
  });

  it("only an owner or admin of the organization may ask; a signed-out visitor, a plain coach, the owner's row, one's own row and people outside the organization are all refused", async () => {
    state.user = null;
    expect((await signin(req({ groupId: G, profileId: "kade" }))).status).toBe(401);
    state.user = { id: "kade" };
    expect((await signin(req({ groupId: G, profileId: "fresh" }))).status).toBe(403);
    state.user = { id: "admin-1" };
    expect((await signin(req({ groupId: G, profileId: "owner" }))).status).toBe(409);
    expect((await signin(req({ groupId: G, profileId: "admin-1" }))).status).toBe(409);
    expect((await signin(req({ groupId: G, profileId: "stranger" }))).status).toBe(404);
    expect((await signin(req({ groupId: G, profileId: "" }))).status).toBe(400);
    expect((await signin(req({ groupId: "nope", profileId: "kade" }))).status).toBe(400);
    // an unused invitation that another organization also made is out of reach (the footprint rule)
    expect((await signin(req({ groupId: G, profileId: "elsewhere" }))).status).toBe(404);
    expect(state.generated).toHaveLength(0);
    expect(state.mails).toHaveLength(0);
  });
});

describe("how a coach stands, in words", () => {
  it("is invited, signed in (when) or never signed in", () => {
    expect(signInWords(signInFacts({ invited_at: "2026-10-17T09:00:00Z" }))).toBe("Invited, not accepted yet");
    expect(signInWords(signInFacts({ invited_at: "2026-10-17T09:00:00Z", email_confirmed_at: "2026-10-17T09:05:00Z", last_sign_in_at: "2026-10-17T09:05:00Z" }), new Date("2026-10-20T00:00:00Z"))).toBe("Signed in Oct 17");
    expect(signInWords(signInFacts({ invited_at: "2026-10-17T09:00:00Z", email_confirmed_at: "2026-10-17T09:05:00Z" }))).toBe("Has never signed in");
    expect(signInWords(signInFacts({}))).toBe("Has never signed in");
    expect(shortDate("2025-03-04T10:00:00Z", new Date("2026-10-20T00:00:00Z"))).toBe("Mar 4, 2025");
  });

  it("an invitation whose newest link is over a day old says so", () => {
    const f = signInFacts({ invited_at: "2026-10-15T09:00:00Z", app_metadata: { invite_emailed_at: "2026-10-16T09:00:00Z" } });
    expect(f.linkMadeAt).toBe("2026-10-16T09:00:00Z");
    expect(inviteLinkProbablyDead(f, Date.parse("2026-10-16T20:00:00Z"))).toBe(false);
    expect(inviteLinkProbablyDead(f, Date.parse("2026-10-17T10:00:00Z"))).toBe(true);
    expect(inviteLinkProbablyDead(signInFacts({ last_sign_in_at: "2026-10-01T00:00:00Z" }), Date.now())).toBe(false);
  });
});

describe("the screens", () => {
  it("a coach's name in the Coaches list opens that coach's page; an owner or admin gets Send sign-in link on every other row", () => {
    const s = src("components/coach/coaches-section.tsx");
    expect(s).toContain("/groups/${groupId}/coaches/${c.profileId}");
    expect(s).toContain("SendSignInLink");
    expect(s).toContain('sendLabel="Send sign-in link"');
    expect(s).toContain("That link expired or was already used. Send a new one.");
    expect(s).toContain("c.orgRole !== \"owner\"");
  });

  it("the coach's page: coaches of the group only, the person must be one of the organization's coaches, email and sign-in facts for an owner or admin only, no client names", () => {
    const p = src("app/(coach)/groups/[groupId]/coaches/[profileId]/page.tsx");
    expect(p).toContain('mine?.role !== "coach"');
    expect(p).toContain("if (!list.organizationId || !coach) notFound();");
    expect(p).toContain("manager.ok");
    expect(p).toContain('g.group_kind !== "one_on_one"');
    expect(p).toContain("A link goes to their own email address. You never see it.");
  });

  it("Copy link says it replaces the link in the email", () => {
    expect(src("components/org/pending-invite-actions.tsx")).toContain("Copy link makes a new link and replaces the one in the email.");
  });

  it("a team-sport group has no Business button in the left panel, and a pinned Business view never shows there", () => {
    const panel = src("components/coach/desktop/shell-list-panel.tsx");
    expect(panel).toContain("{!teamSport && (");
    expect(panel).toContain('teamSport && pickedView === "business" ? "roster" : pickedView');
    expect(src("components/coach/coach-desktop-shell.tsx")).toContain("teamSport={teamSport}");
  });
});
