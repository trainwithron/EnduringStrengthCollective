import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  users: {} as Record<string, Record<string, unknown>>,
  generated: [] as { type: string; email: string }[],
  updated: [] as { id: string; attrs: Record<string, unknown> }[],
  passwordFails: false,
  mails: [] as { to: string; subject: string; text: string }[],
  mailOk: true,
  seq: 0,
  now: Date.now(),
}));

const isOpen = (r: Record<string, unknown>) => r.used_at == null && r.revoked_at == null;

// A small in-memory database: eq / is / gt filters, insert (with the one-open-link rule), update, maybeSingle / single, lists.
function table(name: string) {
  const all = (state.tables[name] ??= []);
  let rows = [...all];
  let inserting: Record<string, unknown> | null = null;
  let updating: Record<string, unknown> | null = null;
  const result = () => {
    if (inserting) {
      if (name === "coach_join_links" && all.some((r) => isOpen(r) && r.profile_id === inserting!.profile_id && r.organization_id === inserting!.organization_id)) return { data: null, error: { code: "23505", message: "duplicate" } };
      state.seq += 1;
      const row = { id: `00000000-0000-4000-8000-${String(state.seq).padStart(12, "0")}`, kind: "invite", created_at: new Date().toISOString(), used_at: null, revoked_at: null, ...inserting };
      all.push(row);
      return { data: [row], error: null };
    }
    if (updating) {
      for (const r of rows) Object.assign(r, updating);
      return { data: rows, error: null };
    }
    return { data: rows, error: null, count: rows.length };
  };
  const b: any = {
    select: () => b,
    insert: (v: Record<string, unknown>) => ((inserting = v), b),
    update: (v: Record<string, unknown>) => ((updating = v), b),
    eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), b),
    is: (col: string) => ((rows = rows.filter((r) => r[col] == null)), b),
    gt: (col: string, val: string) => ((rows = rows.filter((r) => String(r[col]) > val)), b),
    maybeSingle: async () => {
      const r = result();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
    },
    single: async () => {
      const r = result();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
    },
    then: (resolve: (v: unknown) => void) => resolve(result()),
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
        updateUserById: async (id: string, attrs: Record<string, unknown>) => {
          if (attrs.password && state.passwordFails) return { error: { message: "no" } };
          state.updated.push({ id, attrs });
          return { error: null };
        },
        generateLink: async (a: { type: string; email: string }) => (state.generated.push({ type: a.type, email: a.email }), { data: { properties: { action_link: `https://auth.example/${a.type}?token=SECRET` }, user: { id: "x" } }, error: null }),
      },
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null, clientIp: () => "1.2.3.4" }));
vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => true,
  sendEmail: async (to: string, subject: string, text: string) => (state.mails.push({ to, subject, text }), state.mailOk),
}));

import { POST as signin } from "@/app/api/coaches/invite/signin/route";
import { POST as resend } from "@/app/api/coaches/invite/resend/route";
import { POST as copyLink } from "@/app/api/coaches/invite/link/route";
import * as joinRoute from "@/app/api/coaches/join/route";
import JoinCoachPage from "@/app/join-coach/[token]/page";
import { inviteLinkProbablyDead, shortDate, signInFacts, signInWords } from "@/lib/coach-invite-server";
import { joinLinkToken, parseJoinLinkToken, joinLinkUrl, joinLinkState, ensureJoinLink } from "@/lib/coach-join-link";

process.env.JOIN_LINK_SECRET = "test-secret-for-join-links";
const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const G = "group-1";
const ORG = "org-1";
const post = (url: string, body: unknown) => new Request(`https://app.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const req = (body: unknown) => post("/api/coaches/invite/signin", body);
const long = "2026-10-01T10:00:00Z";
const tokenIn = (url: string) => decodeURIComponent(url.split("/join-coach/")[1]);
const linksOf = (profile: string) => (state.tables.coach_join_links ?? []).filter((r) => r.profile_id === profile);

beforeEach(() => {
  state.user = { id: "admin-1" };
  state.generated = [];
  state.updated = [];
  state.passwordFails = false;
  state.mails = [];
  state.mailOk = true;
  state.seq = 0;
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
    coach_join_links: [],
    profiles: [
      { id: "admin-1", full_name: "Ron Arnold" },
      { id: "kade", full_name: "Kade Thompson" },
      { id: "fresh", full_name: "Fran Fresh" },
      { id: "never", full_name: "Nate Never" },
    ],
    organizations: [{ id: ORG, name: "Lee County West Trojans" }],
  };
});

describe("the link: one per person, signed by the server, nothing secret stored", () => {
  it("is /join-coach/<id>.<signature>; a wrong signature, a changed id and junk give nothing", () => {
    const id = "00000000-0000-4000-8000-000000000007";
    const token = joinLinkToken(id);
    expect(joinLinkUrl("https://spotlightcoaching.app/", id)).toBe(`https://spotlightcoaching.app/join-coach/${token}`);
    expect(parseJoinLinkToken(token)).toBe(id);
    expect(parseJoinLinkToken(token.slice(0, -2) + "xx")).toBeNull();
    expect(parseJoinLinkToken(token.replace("0007", "0008"))).toBeNull();
    for (const bad of [null, undefined, "", "abc", id, `${id}.`, `${id}.${"a".repeat(43)}`, 42, "x".repeat(500)]) expect(parseJoinLinkToken(bad), String(bad)).toBeNull();
  });

  it("states: open, expired, used, cancelled", () => {
    const base = { expires_at: "2026-10-20T00:00:00Z", used_at: null, revoked_at: null };
    const now = new Date("2026-10-19T00:00:00Z");
    expect(joinLinkState(base, now)).toBe("open");
    expect(joinLinkState(base, new Date("2026-10-21T00:00:00Z"))).toBe("expired");
    expect(joinLinkState({ ...base, used_at: "2026-10-18T00:00:00Z" }, now)).toBe("used");
    expect(joinLinkState({ ...base, revoked_at: "2026-10-18T00:00:00Z" }, now)).toBe("revoked");
  });

  it("ensureJoinLink keeps the SAME link when asked again, moves its end date out when sending or when it ended, and only a link of the other kind is replaced", async () => {
    const db = { from: (t: string) => table(t) };
    const args = { organizationId: ORG, profileId: "fresh", kind: "invite" as const, createdBy: "admin-1", extend: false };
    const first = await ensureJoinLink(db, { ...args, now: new Date("2026-10-01T00:00:00Z") });
    expect(first.ok && first.created).toBe(true);
    if (!first.ok) return;
    const again = await ensureJoinLink(db, { ...args, now: new Date("2026-10-05T00:00:00Z") });
    expect(again.ok && again.row.id).toBe(first.row.id);
    expect(again.ok && again.created).toBe(false);
    expect(again.ok && again.row.expires_at).toBe(first.row.expires_at);
    const sent = await ensureJoinLink(db, { ...args, extend: true, now: new Date("2026-10-05T00:00:00Z") });
    expect(sent.ok && sent.row.id).toBe(first.row.id);
    expect(sent.ok && sent.row.expires_at).toBe("2026-10-19T00:00:00.000Z");
    const ended = await ensureJoinLink(db, { ...args, now: new Date("2026-11-30T00:00:00Z") });
    expect(ended.ok && ended.row.id).toBe(first.row.id);
    expect(ended.ok && ended.row.expires_at).toBe("2026-12-14T00:00:00.000Z");
    const other = await ensureJoinLink(db, { ...args, kind: "signin" });
    expect(other.ok && other.row.id).not.toBe(first.row.id);
    expect(linksOf("fresh").filter(isOpen)).toHaveLength(1);
    expect(linksOf("fresh").find((r) => r.id === first.row.id)?.revoked_at).toBeTruthy();
  });
});

describe("Email it / Copy invite link: the same link, nothing cancelled", () => {
  it("the emailed link and the copied link are the same, in either order, as often as you like", async () => {
    const copied1 = await (await copyLink(post("/api/coaches/invite/link", { groupId: G, profileId: "fresh" }))).json();
    expect(copied1.link).toMatch(/^https:\/\/app\.test\/join-coach\//);
    const emailed = await resend(post("/api/coaches/invite/resend", { groupId: G, profileId: "fresh" }));
    expect((await emailed.json()).emailed).toBe(true);
    expect(state.mails[0].text).toContain(copied1.link);
    const copied2 = await (await copyLink(post("/api/coaches/invite/link", { groupId: G, profileId: "fresh" }))).json();
    expect(copied2.link).toBe(copied1.link);
    expect(linksOf("fresh")).toHaveLength(1);
    expect(state.generated).toHaveLength(0);
    // sending the email again keeps the link and does not need a copied one to be copied again
    state.users.fresh.app_metadata = {};
    await resend(post("/api/coaches/invite/resend", { groupId: G, profileId: "fresh" }));
    expect(state.mails[1].text).toContain(copied1.link);
  });

  it("a person who has signed in never gets an invitation link shown to the administrator", async () => {
    const res = await copyLink(post("/api/coaches/invite/link", { groupId: G, profileId: "kade" }));
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain("join-coach");
  });
});

describe("Send sign-in link", () => {
  it("a coach who has signed in gets a link to set a new password in their OWN inbox, and the link is never shown to the admin", async () => {
    const res = await signin(req({ groupId: G, profileId: "kade" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, emailed: true, kind: "sign-in" });
    expect(JSON.stringify(body)).not.toContain("join-coach");
    expect(state.generated).toHaveLength(0);
    expect(state.mails).toHaveLength(1);
    expect(state.mails[0].to).toBe("kade@x.co");
    expect(state.mails[0].text).toMatch(/https:\/\/app\.test\/join-coach\/[0-9a-f-]{36}\./);
    expect(state.mails[0].text).toContain("Ron Arnold sent you this link");
    expect(linksOf("kade")).toMatchObject([{ kind: "signin", profile_id: "kade", organization_id: ORG }]);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].attrs.app_metadata).toMatchObject({ signin_emailed_at: expect.any(String), invite_emailed_at: "2026-10-17T21:47:53Z" });
  });

  it("an account that has never signed in (a link opened without a sign-in) gets the same", async () => {
    const res = await signin(req({ groupId: G, profileId: "never" }));
    expect((await res.json()).kind).toBe("sign-in");
    expect(linksOf("never")[0].kind).toBe("signin");
  });

  it("an invitation nobody has used is sent again as the invitation: the same link", async () => {
    const res = await signin(req({ groupId: G, profileId: "fresh" }));
    expect(await res.json()).toMatchObject({ ok: true, emailed: true, kind: "invitation" });
    expect(linksOf("fresh")[0].kind).toBe("invite");
    expect(state.mails[0].subject).toBe("Lee County West Trojans invited you to join");
    expect(state.updated[0].attrs.app_metadata).toHaveProperty("invite_emailed_at");
  });

  it("once in ten minutes: a second press sends nothing", async () => {
    state.users.kade.app_metadata = { signin_emailed_at: new Date().toISOString() };
    const res = await signin(req({ groupId: G, profileId: "kade" }));
    expect(res.status).toBe(429);
    expect(state.mails).toHaveLength(0);
    expect(linksOf("kade")).toHaveLength(0);
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
    expect(state.mails).toHaveLength(0);
    expect(state.tables.coach_join_links).toHaveLength(0);
  });
});

describe("the join page and what finishes it", () => {
  const link = async (profile: string, kind: "invite" | "signin" = "invite", org = ORG) => {
    const made = await ensureJoinLink({ from: (t: string) => table(t) }, { organizationId: org, profileId: profile, kind, createdBy: "admin-1", extend: false });
    if (!made.ok) throw new Error("no link");
    return { id: made.row.id, token: joinLinkToken(made.row.id) };
  };
  const join = (token: string, password = "a-long-password") => joinRoute.POST(post("/api/coaches/join", { token, password }));

  it("OPENING the link changes nothing: the page only reads (a GET or a HEAD, a scanner, a preview), and the route has no GET or HEAD at all", async () => {
    const { id, token } = await link("fresh");
    const before = JSON.stringify(state.tables.coach_join_links);
    const page = await JoinCoachPage({ params: Promise.resolve({ token }) });
    expect(JSON.stringify(page)).toContain("Lee County West Trojans");
    expect(JSON.stringify(state.tables.coach_join_links)).toBe(before);
    expect(state.updated).toHaveLength(0);
    expect(state.generated).toHaveLength(0);
    expect(Object.keys(joinRoute).filter((k) => /^(GET|HEAD|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
    expect(linksOf("fresh")[0].used_at).toBeNull();
    expect(id).toBeTruthy();
    const p = src("app/join-coach/[token]/page.tsx");
    expect(p).not.toMatch(/\.(insert|update|upsert|delete)\(|updateUserById|signInWith|generateLink/);
    const form = src("components/auth/join-coach-form.tsx");
    expect(form).not.toMatch(/useEffect|autoFocus|requestSubmit|\.submit\(\)/);
    expect(form).toContain('type="submit"');
    expect(form.match(/fetch\(/g)).toHaveLength(1);
  });

  it("a bad, cancelled, used or ended link gets a plain page, never the form", async () => {
    const html = async (token: string) => JSON.stringify(await JoinCoachPage({ params: Promise.resolve({ token }) }));
    expect(await html("nonsense")).toContain("That link isn't valid");
    const { id, token } = await link("fresh");
    state.tables.coach_join_links[0].revoked_at = "2026-10-01T00:00:00Z";
    expect(await html(token)).toContain("cancelled");
    state.tables.coach_join_links[0].revoked_at = null;
    state.tables.coach_join_links[0].used_at = "2026-10-01T00:00:00Z";
    expect(await html(token)).toContain("already used");
    state.tables.coach_join_links[0].used_at = null;
    state.tables.coach_join_links[0].expires_at = "2020-01-01T00:00:00Z";
    expect(await html(token)).toContain("expired");
    expect(id).toBeTruthy();
  });

  it("choosing a password sets it for the INVITED account only, uses the link up, and tells the page whom to sign in as", async () => {
    const { token } = await link("fresh");
    const res = await join(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "fresh@x.co" });
    expect(state.updated).toEqual([{ id: "fresh", attrs: { password: "a-long-password", email_confirm: true } }]);
    expect(linksOf("fresh")[0].used_at).toBeTruthy();
    // a second press, or a second tab
    const again = await join(token);
    expect(again.status).toBe(409);
    expect((await again.json()).signIn).toBe(true);
    expect(state.updated).toHaveLength(1);
  });

  it("an account the link was not made for is never touched: the id in the link decides, and another organization's person is out of reach", async () => {
    const mine = await link("fresh");
    await join(mine.token);
    expect(state.updated.every((u) => u.id === "fresh")).toBe(true);
    const foreign = await link("stranger", "invite", ORG);
    const r = await join(foreign.token);
    expect(r.status).toBe(404);
    const elsewhere = await link("elsewhere");
    expect((await join(elsewhere.token)).status).toBe(404);
    expect(state.updated.filter((u) => u.id !== "fresh")).toHaveLength(0);
  });

  it("an invitation link will not set the password of an account that has already signed in (and is not used up by trying); a sign-in link does", async () => {
    const inv = await link("kade", "invite");
    const r = await join(inv.token);
    expect(r.status).toBe(409);
    expect(linksOf("kade")[0].used_at).toBeNull();
    expect(state.updated).toHaveLength(0);
    state.tables.coach_join_links = [];
    const sign = await link("kade", "signin");
    const ok = await join(sign.token);
    expect(ok.status).toBe(200);
    expect(state.updated).toEqual([{ id: "kade", attrs: { password: "a-long-password", email_confirm: true } }]);
  });

  it("refuses: no signature, a too-short password, a cancelled link, an ended link, the owner's row; and gives the link back when the password could not be saved", async () => {
    const { token } = await link("fresh");
    expect((await join("junk")).status).toBe(404);
    expect((await join(token, "123")).status).toBe(400);
    expect(linksOf("fresh")[0].used_at).toBeNull();
    state.passwordFails = true;
    expect((await join(token)).status).toBe(500);
    expect(linksOf("fresh")[0].used_at).toBeNull();
    state.passwordFails = false;
    state.tables.coach_join_links[0].expires_at = "2020-01-01T00:00:00Z";
    expect((await join(token)).status).toBe(410);
    state.tables.coach_join_links[0].expires_at = "2099-01-01T00:00:00Z";
    state.tables.coach_join_links[0].revoked_at = "2026-10-01T00:00:00Z";
    expect((await join(token)).status).toBe(404);
    state.tables.coach_join_links = [];
    const own = await link("owner", "signin");
    expect((await join(own.token)).status).toBe(404);
    expect(state.updated).toHaveLength(0);
  });
});

describe("how a coach stands, in words", () => {
  it("is invited, signed in (when) or never signed in", () => {
    expect(signInWords(signInFacts({ invited_at: "2026-10-17T09:00:00Z" }))).toBe("Invited, not accepted yet");
    expect(signInWords(signInFacts({ invited_at: "2026-10-17T09:00:00Z", email_confirmed_at: "2026-10-17T09:05:00Z", last_sign_in_at: "2026-10-17T15:00:00Z" }), new Date("2026-10-20T00:00:00Z"))).toBe("Signed in Oct 17");
    expect(signInWords(signInFacts({ invited_at: "2026-10-17T09:00:00Z", email_confirmed_at: "2026-10-17T09:05:00Z" }))).toBe("Has never signed in");
    expect(signInWords(signInFacts({}))).toBe("Has never signed in");
    expect(shortDate("2025-03-04T10:00:00Z", new Date("2026-10-20T00:00:00Z"))).toBe("Mar 4, 2025");
  });

  it("signed in seconds after an invitation link was made is labeled honestly (Kade's case), and a plain later sign-in is not", () => {
    const kade = signInFacts({ invited_at: "2026-10-17T21:48:49Z", email_confirmed_at: "2026-10-17T21:49:02Z", last_sign_in_at: "2026-10-17T21:49:02Z", app_metadata: { invite_emailed_at: "2026-10-17T21:47:53Z", invite_link_made_at: "2026-10-17T21:48:49Z" } });
    expect(kade.signedInRightAfterLink).toBe(true);
    expect(signInWords(kade, new Date("2026-10-18T00:00:00Z"))).toMatch(/^Signed in Oct 17 by an invitation link, right after it was made/);
    const later = signInFacts({ invited_at: "2026-10-17T21:48:49Z", last_sign_in_at: "2026-10-19T08:00:00Z", app_metadata: { invite_link_made_at: "2026-10-17T21:48:49Z" } });
    expect(later.signedInRightAfterLink).toBe(false);
    expect(signInWords(later, new Date("2026-10-20T00:00:00Z"))).toBe("Signed in Oct 19");
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

  it("Copy invite link and Email it are the same link and say so; neither cancels anything", () => {
    const a = src("components/org/pending-invite-actions.tsx");
    expect(a).toContain("The email and the copied link are the same link.");
    expect(a).toContain("Copy invite link");
    expect(a).toContain("Email it");
  });

  it("a team-sport group has no Business button in the left panel, and a pinned Business view never shows there", () => {
    const panel = src("components/coach/desktop/shell-list-panel.tsx");
    expect(panel).toContain("{!hideMoney && (");
    expect(panel).toContain('hideMoney && pickedView === "business" ? "roster" : pickedView');
    expect(src("components/coach/coach-desktop-shell.tsx")).toContain("hideMoney={moneyHidden}");
  });
});
