import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { inviteEmail, makeAuthLink, oneLine, recoveryEmail, sendAuthMail } from "./auth-mail";
import { authorizeInviteManager, inviteOnlyFootprint, isUnaccepted, loadInviteTarget, loadPendingInvitees, markSent, removeOrphanInvitee, sentRecently } from "./coach-invite-server";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const envBackup = { key: process.env.BREVO_API_KEY, from: process.env.BREVO_FROM_EMAIL };
afterEach(() => {
  if (envBackup.key === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = envBackup.key;
  if (envBackup.from === undefined) delete process.env.BREVO_FROM_EMAIL;
  else process.env.BREVO_FROM_EMAIL = envBackup.from;
});

describe("invitation and sign-in emails are made and sent by us", () => {
  it("the invitation email names who invited, the organization and the role, carries the link, and says when it stops working", () => {
    const m = inviteEmail({ toName: "Cade Thompson", orgName: "Lee County West Trojans", inviterName: "Ron Arnold", role: "admin", link: "https://x.example/verify?token=abc" });
    expect(m.subject).toBe("Lee County West Trojans invited you to join");
    expect(m.text).toContain("Hi Cade,");
    expect(m.text).toContain("Ron Arnold invited you to join Lee County West Trojans on Spotlight Coaching as an admin.");
    expect(m.text).toContain("https://x.example/verify?token=abc");
    expect(m.text).toMatch(/Opening it does not use it up/);
    // no promise about how long it lasts
    expect(m.text).not.toMatch(/a day|24 hours|hour/i);
    expect(inviteEmail({ toName: "", orgName: "O", inviterName: null, role: "front_desk", link: "l" }).text).toContain("front desk staff");
  });

  it("text an administrator chose is one short line: control characters and newlines are dropped and each part is cut at 60 characters", () => {
    const evil = "Real Gym" + String.fromCharCode(10) + "Bcc: x@y.co" + String.fromCharCode(13, 0, 7) + " ".repeat(5) + "z".repeat(200);
    const clean = oneLine(evil);
    expect(clean).not.toMatch(/[\u0000-\u001f]/);
    expect(clean.length).toBeLessThanOrEqual(60);
    expect(oneLine(null)).toBe("");
    const m = inviteEmail({ toName: evil, orgName: evil, inviterName: evil, role: "coach", link: "https://l" });
    expect(m.subject).not.toMatch(/[\u0000-\u001f]/);
    expect(m.subject.length).toBeLessThanOrEqual("  invited you to join".length + 60);
    expect(m.text.split(String.fromCharCode(10)).filter((line) => line.includes("Bcc:")).length).toBeLessThanOrEqual(1);
    expect(m.text).not.toContain(String.fromCharCode(0));
  });

  it("the reset email is plain and promises nothing about whether an account exists", () => {
    const m = recoveryEmail({ toName: null, link: "https://x.example/r" });
    expect(m.subject).toBe("Reset your password");
    expect(m.text).toContain("https://x.example/r");
    expect(m.text).toContain("If you did not ask for this");
    expect(recoveryEmail({ toName: "Sam Lee", link: "l", fromCoach: "Your coach" }).text).toContain("Your coach sent you this link");
  });

  it("makeAuthLink returns the one-time link and the account id, or an error and no link", async () => {
    const ok = { auth: { admin: { generateLink: async () => ({ data: { properties: { action_link: "https://a/b" }, user: { id: "u1" } }, error: null }) } } };
    expect(await makeAuthLink(ok, { type: "invite", email: "a@b.co", redirectTo: "https://app/set-password", fullName: "A B" })).toEqual({ link: "https://a/b", userId: "u1", error: null });
    const bad = { auth: { admin: { generateLink: async () => ({ data: null, error: { message: "already registered" } }) } } };
    const r = await makeAuthLink(bad, { type: "invite", email: "a@b.co", redirectTo: "r" });
    expect(r.link).toBeNull();
    expect(r.error).toBe("already registered");
  });

  it("an invitation link carries the person's name; a reset link does not", async () => {
    const seen: unknown[] = [];
    const db = { auth: { admin: { generateLink: async (a: unknown) => (seen.push(a), { data: { properties: { action_link: "l" }, user: { id: "u" } }, error: null }) } } };
    await makeAuthLink(db, { type: "invite", email: "a@b.co", redirectTo: "r", fullName: "Cade T" });
    await makeAuthLink(db, { type: "recovery", email: "a@b.co", redirectTo: "r", fullName: "Cade T" });
    expect(JSON.stringify(seen[0])).toContain('"full_name":"Cade T"');
    expect(JSON.stringify(seen[1])).not.toContain("full_name");
  });

  it("nothing is sent (and the caller is told so) when the mail service is not set up", async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_FROM_EMAIL;
    expect(await sendAuthMail("a@b.co", { subject: "s", text: "t" })).toBe(false);
  });
});

describe("who has not accepted yet, and who may manage invitations", () => {
  it("an account never confirmed and never signed in is an unaccepted invitation; anything else is not", () => {
    const invited = "2026-10-16T17:00:00Z";
    expect(isUnaccepted({ invited_at: invited, email_confirmed_at: null, last_sign_in_at: null })).toBe(true);
    expect(isUnaccepted({ invited_at: invited, email_confirmed_at: "2026-10-01", last_sign_in_at: null })).toBe(false);
    expect(isUnaccepted({ invited_at: invited, email_confirmed_at: null, last_sign_in_at: "2026-10-01" })).toBe(false);
    // an account made some other way (seeded, created by an administrator) carries no invitation marker and is never treated as an invitation
    expect(isUnaccepted({ invited_at: null, email_confirmed_at: null, last_sign_in_at: null })).toBe(false);
    expect(isUnaccepted(null)).toBe(false);
  });

  type U = { email: string; email_confirmed_at: string | null; last_sign_in_at: string | null; invited_at?: string };
  type Row = Record<string, unknown>;
  // A small in-memory database: tables of rows (eq filters, maybeSingle, plain lists, counts) and the auth admin API.
  function adminDb(users: Record<string, U>, tables: Record<string, Row[]>, deleted: string[] = [], deleteError: boolean = false) {
    return {
      auth: {
        admin: {
          getUserById: async (id: string) => ({ data: { user: users[id] ? { id, ...users[id] } : null } }),
          deleteUser: async (id: string) => {
            if (deleteError) return { error: { message: "no" } };
            deleted.push(id);
            return { error: null };
          },
        },
      },
      from: (table: string) => {
        let rows = [...(tables[table] ?? [])];
        const b: any = {
          select: () => b,
          eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), b),
          is: (col: string) => ((rows = rows.filter((r) => r[col] == null)), b),
          gt: (col: string, val: string) => ((rows = rows.filter((r) => String(r[col]) > val)), b),
          maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null, count: rows.length }),
        };
        return b;
      },
    };
  }
  const ORG = "org-a";
  const OTHER = "org-b";
  const invitedAt = "2026-10-16T17:00:00Z";
  const coachSeat = (profile_id: string, org = ORG) => ({ profile_id, role: "coach", groups: { organization_id: org } });
  const unaccepted = (email: string): U => ({ email, email_confirmed_at: null, last_sign_in_at: null, invited_at: invitedAt });

  it("lists the unaccepted among the people given, newest first, and leaves out anyone accepted, unreadable, made another way or belonging to another organization", async () => {
    const db = adminDb(
      {
        a: { ...unaccepted("a@x.co"), invited_at: "2026-10-16T17:00:00Z" },
        b: { email: "b@x.co", email_confirmed_at: "2026-10-01", last_sign_in_at: "2026-10-02", invited_at: invitedAt },
        c: { ...unaccepted("c@x.co"), invited_at: "2026-10-17T09:00:00Z" },
        d: { email: "d@x.co", email_confirmed_at: null, last_sign_in_at: null },
        e: unaccepted("e@x.co"),
      },
      {
        organization_memberships: [
          { profile_id: "a", organization_id: ORG, role: "admin" },
          { profile_id: "b", organization_id: ORG, role: "coach" },
          { profile_id: "d", organization_id: ORG, role: "coach" },
          { profile_id: "e", organization_id: ORG, role: "coach" },
          { profile_id: "e", organization_id: OTHER, role: "coach" },
        ],
        org_front_desk: [{ profile_id: "c", organization_id: ORG }],
      }
    );
    const list = await loadPendingInvitees(db, ORG, [
      { profileId: "a", name: "Cade", role: "admin" },
      { profileId: "b", name: "Bea", role: "coach" },
      { profileId: "c", name: "Dee", role: "front_desk" },
      { profileId: "d", name: "Seeded", role: "coach" },
      { profileId: "e", name: "Both orgs", role: "coach" },
      { profileId: "missing", name: "Ghost", role: "coach" },
    ]);
    expect(list.map((p) => p.profileId)).toEqual(["c", "a"]);
    expect(list[1]).toMatchObject({ name: "Cade", email: "a@x.co", role: "admin", sentAt: "2026-10-16T17:00:00Z" });
  });

  it("a target must belong to the organization, must not be the owner, must not have accepted and must exist only because this organization invited it", async () => {
    const users = {
      p1: unaccepted("p1@x.co"),
      p2: { email: "p2@x.co", email_confirmed_at: "2026-10-01", last_sign_in_at: null, invited_at: invitedAt },
      own: unaccepted("own@x.co"),
      desk: unaccepted("d@x.co"),
      seeded: { email: "s@x.co", email_confirmed_at: null, last_sign_in_at: null },
      shared: unaccepted("shared@x.co"),
      client: unaccepted("client@x.co"),
    };
    const db = adminDb(users, {
      organization_memberships: [
        { profile_id: "p1", organization_id: ORG, role: "coach" },
        { profile_id: "p2", organization_id: ORG, role: "admin" },
        { profile_id: "own", organization_id: ORG, role: "owner" },
        { profile_id: "seeded", organization_id: ORG, role: "coach" },
        { profile_id: "shared", organization_id: ORG, role: "coach" },
        { profile_id: "shared", organization_id: OTHER, role: "admin" },
        { profile_id: "client", organization_id: ORG, role: "coach" },
      ],
      org_front_desk: [{ profile_id: "desk", organization_id: ORG }],
      group_memberships: [coachSeat("p1"), { profile_id: "client", role: "athlete", groups: { organization_id: ORG } }],
    });
    expect(await loadInviteTarget(db, ORG, "p1")).toMatchObject({ ok: true, email: "p1@x.co", role: "coach" });
    expect(await loadInviteTarget(db, ORG, "desk")).toMatchObject({ ok: true, role: "front_desk" });
    expect(await loadInviteTarget(db, ORG, "stranger")).toMatchObject({ ok: false, status: 404 });
    expect(await loadInviteTarget(db, ORG, "own")).toMatchObject({ ok: false, status: 404 });
    expect(await loadInviteTarget(db, ORG, "p2")).toMatchObject({ ok: false, status: 409 });
    expect(await loadInviteTarget(db, ORG, "")).toMatchObject({ ok: false, status: 400 });
    // a member whose account was not made by an invitation is not an invitation to cancel or resend
    expect(await loadInviteTarget(db, ORG, "seeded")).toMatchObject({ ok: false, status: 409 });
    // an account another organization also holds, or one that is a client somewhere, is out of reach: no link, no resend
    expect(await loadInviteTarget(db, ORG, "shared")).toMatchObject({ ok: false, status: 404 });
    expect(await loadInviteTarget(db, ORG, "client")).toMatchObject({ ok: false, status: 404 });
    // the other organization cannot reach the first one's invitee at all
    expect(await loadInviteTarget(db, OTHER, "p1")).toMatchObject({ ok: false, status: 404 });
  });

  it("another organization's pending invitee is out of reach: inviteOnlyFootprint says no for it, yes for the organization that invited it", async () => {
    const db = adminDb({}, { organization_memberships: [{ profile_id: "v", organization_id: ORG, role: "admin" }], group_memberships: [coachSeat("v")] });
    expect(await inviteOnlyFootprint(db, ORG, "v")).toEqual({ ok: true });
    expect((await inviteOnlyFootprint(db, OTHER, "v")).ok).toBe(false);
    // a person with no invitation seat at all is not an invitation of anyone
    expect((await inviteOnlyFootprint(adminDb({}, {}), ORG, "nobody")).ok).toBe(false);
  });

  it("an account somebody else has an open invitation for is out of reach too: another organization's in-app invitation, a space invitation or a client invitation", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    const base = { organization_memberships: [{ profile_id: "v", organization_id: ORG, role: "admin" }], group_memberships: [coachSeat("v")] };
    const users = { v: unaccepted("v@x.co") };
    // none open: fine
    expect((await inviteOnlyFootprint(adminDb(users, base), ORG, "v")).ok).toBe(true);
    // org B invited the same account in the app and it is still open: org A may not mint a link for it
    expect((await inviteOnlyFootprint(adminDb(users, { ...base, organization_invites: [{ invited_profile_id: "v", organization_id: OTHER, answered_at: null, expires_at: future }] }), ORG, "v")).ok).toBe(false);
    // answered or expired ones do not count
    expect((await inviteOnlyFootprint(adminDb(users, { ...base, organization_invites: [{ invited_profile_id: "v", organization_id: OTHER, answered_at: "2026-10-01", expires_at: future }] }), ORG, "v")).ok).toBe(true);
    expect((await inviteOnlyFootprint(adminDb(users, { ...base, organization_invites: [{ invited_profile_id: "v", organization_id: OTHER, answered_at: null, expires_at: past }] }), ORG, "v")).ok).toBe(true);
    // this organization's own open in-app invitation is not a problem
    expect((await inviteOnlyFootprint(adminDb(users, { ...base, organization_invites: [{ invited_profile_id: "v", organization_id: ORG, answered_at: null, expires_at: future }] }), ORG, "v")).ok).toBe(true);
    // a space invitation or a client invitation that is still open
    expect((await inviteOnlyFootprint(adminDb(users, { ...base, space_invites: [{ invited_profile_id: "v", answered_at: null, expires_at: future }] }), ORG, "v")).ok).toBe(false);
    expect((await inviteOnlyFootprint(adminDb(users, { ...base, client_invites: [{ athlete_id: "v", used_at: null, revoked_at: null, expires_at: future }] }), ORG, "v")).ok).toBe(false);
    expect((await inviteOnlyFootprint(adminDb(users, { ...base, client_invites: [{ athlete_id: "v", used_at: null, revoked_at: "2026-10-02", expires_at: future }] }), ORG, "v")).ok).toBe(true);
  });

  it("cancelling needs an account that has made nothing; anything it has made keeps it from being deleted", async () => {
    const mk = (extra: Record<string, Row[]>) => adminDb({}, { organization_memberships: [{ profile_id: "v", organization_id: ORG, role: "coach" }], group_memberships: [coachSeat("v")], ...extra });
    expect((await inviteOnlyFootprint(mk({}), ORG, "v", { withData: true })).ok).toBe(true);
    for (const table of ["client_intake", "posts", "direct_messages", "programs"]) {
      const col = table === "client_intake" ? "athlete_id" : table === "posts" ? "author_id" : table === "direct_messages" ? "sender_id" : "created_by";
      const r = await inviteOnlyFootprint(mk({ [table]: [{ [col]: "v" }] }), ORG, "v", { withData: true });
      expect(r.ok, table).toBe(false);
    }
  });

  it("a send is remembered on the account only after it succeeded, and blocks another within ten minutes", async () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0);
    expect(sentRecently({}, "invite_emailed_at", now)).toBe(false);
    expect(sentRecently(undefined, "invite_emailed_at", now)).toBe(false);
    expect(sentRecently({ invite_emailed_at: new Date(now - 5 * 60000).toISOString() }, "invite_emailed_at", now)).toBe(true);
    expect(sentRecently({ invite_emailed_at: new Date(now - 11 * 60000).toISOString() }, "invite_emailed_at", now)).toBe(false);
    // each kind is its own clock
    expect(sentRecently({ invite_emailed_at: new Date(now - 60000).toISOString() }, "invite_link_made_at", now)).toBe(false);
    const written: unknown[] = [];
    await markSent({ auth: { admin: { updateUserById: async (id: string, v: unknown) => written.push([id, v]) } } }, "u1", { keep: 1 }, "invite_link_made_at", now);
    expect(JSON.stringify(written)).toContain('"keep":1');
    expect(JSON.stringify(written)).toContain("invite_link_made_at");
  });

  it("an account left half made by an invitation is removed, but never one that has been used", async () => {
    const deleted: string[] = [];
    const db = (user: object | null) => ({ auth: { admin: { getUserById: async () => ({ data: { user } }), deleteUser: async (id: string) => deleted.push(id) } } });
    await removeOrphanInvitee(db({ invited_at: "2026-10-16T17:00:00Z", email_confirmed_at: null, last_sign_in_at: null }), "orphan");
    await removeOrphanInvitee(db({ invited_at: "2026-10-16T17:00:00Z", email_confirmed_at: "2026-10-17", last_sign_in_at: "2026-10-17" }), "used");
    await removeOrphanInvitee(db({ invited_at: null, email_confirmed_at: null, last_sign_in_at: null }), "seeded");
    expect(deleted).toEqual(["orphan"]);
  });

  it("only an owner or admin of the group's organization manages invitations", async () => {
    const supa = (role: string | null) => ({
      from: (table: string) => {
        const b: any = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => (table === "groups" ? { data: { organization_id: "org" } } : table === "organization_memberships" ? { data: role ? { role } : null } : { data: { full_name: "Ron Arnold" } }),
        };
        return b;
      },
    });
    expect(await authorizeInviteManager(supa("owner"), "u", "g")).toMatchObject({ ok: true, manager: { organizationId: "org", callerName: "Ron Arnold" } });
    expect(await authorizeInviteManager(supa("admin"), "u", "g")).toMatchObject({ ok: true });
    expect(await authorizeInviteManager(supa("coach"), "u", "g")).toMatchObject({ ok: false, status: 403 });
    expect(await authorizeInviteManager(supa(null), "u", "g")).toMatchObject({ ok: false, status: 403 });
    expect(await authorizeInviteManager(supa("owner"), "u", "")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the wiring", () => {
  it("a coach invitation no longer depends on the auth service's mailer: the link is made and the email sent by us, and the answer says whether the email went out", () => {
    const route = src("app/api/coaches/invite/route.ts");
    // the invitation is OUR join link (one per person), not the auth service's one-time link
    expect(route).toContain("ensureJoinLink(");
    expect(route).not.toContain("inviteUserByEmail(");
    expect(route).toContain('makeAuthLink(serviceRole, { type: "invite"');
    expect(route).toContain("sendAuthMail(");
    expect(route).toContain("{ invited: true, emailed }");
    expect(route).toContain("{ invited: true, emailed: sent.emailed }");
    // EVERY success answer has the same keys, so a missing key can never reveal that an address has an account
    const answers = route.match(/NextResponse\.json\(\{ invited: true[^}]*\}\)/g) ?? [];
    expect(answers.length).toBeGreaterThanOrEqual(5);
    for (const a of answers) expect(a, a).toContain("emailed");
    // the neutral answer for a person who is already a member is unchanged
    expect(route).toContain("if (already) return NextResponse.json({ invited: true, emailed: true });");
    // a failure after the account was made removes it again, and an unused earlier invitation takes the new-address path (a fresh link)
    expect(route).toContain("removeOrphanInvitee(serviceRole, newUserId)");
    expect(route).toContain("reuseUserId");
    // only an invitation THIS organization made may be reused with a fresh link
    expect(route).toContain("(await inviteOnlyFootprint(serviceRole, group.organization_id, existingId)).ok");
    expect((route.match(/return fail\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("Send again, Copy link and Cancel are owner/admin only, rate limited, and only for a person of this organization who has not accepted", () => {
    for (const name of ["resend", "link", "cancel"]) {
      const route = src(`app/api/coaches/invite/${name}/route.ts`);
      expect(route, name).toContain("authorizeInviteManager(supabase, user.id, groupId)");
      expect(route, name).toContain("loadInviteTarget(db, ");
      expect(route, name).toContain("rateLimitResponse(");
    }
    expect(src("app/api/coaches/invite/link/route.ts")).toContain('"cache-control": "no-store"');
    // the ten-minute rule is read from the account and written only after success, on both
    const resend = src("app/api/coaches/invite/resend/route.ts");
    expect(resend.indexOf("sentRecently(")).toBeLessThan(resend.indexOf("ensureJoinLink("));
    expect(resend).toContain("if (emailed) await markSent(");
    const link = src("app/api/coaches/invite/link/route.ts");
    // copying the link changes nothing and cancels nothing: no cooldown, no new link, the same one every time
    expect(link).not.toContain("markSent(");
    expect(link).not.toContain("sentRecently(");
    expect(link).toContain("extend: false");
    expect(link).not.toContain("rateLimitResponse(\"coach-invite-link-person\"");
    // a delete that failed is a cancel that did not happen
    const cancel = src("app/api/coaches/invite/cancel/route.ts");
    expect(cancel).toContain("inviteOnlyFootprint(db, orgId, profileId, { withData: true })");
    expect(cancel.indexOf("inviteOnlyFootprint(")).toBeLessThan(cancel.indexOf("deleteUser("));
    // a delete that failed is a cancel that did not happen
    expect(cancel).toContain("if (deleteError)");
    // the account is looked at again right before the delete
    expect(cancel.indexOf("getUserById(profileId)")).toBeLessThan(cancel.indexOf("deleteUser("));
    expect(cancel).toContain("if (!isUnaccepted(fresh?.user))");
  });

  it("the Team page lists every invitation with who, role, status and the three actions, for both kinds", () => {
    const list = src("components/org/invitations-list.tsx");
    const actions = src("components/org/pending-invite-actions.tsx");
    for (const word of ["Not accepted yet", "Email it", "Copy invite link", "Cancel", "Invitations"]) expect(list + actions).toContain(word);
    // the three buttons are one component, used by the Invitations list and by the Coaches list
    expect(list).toContain("<PendingInviteActions ");
    expect(src("components/coach/coaches-section.tsx")).toContain("<PendingInviteActions ");
    expect(actions).toContain("/api/coaches/invite/resend");
    expect(actions).toContain("/api/coaches/invite/link");
    expect(actions).toContain("/api/coaches/invite/cancel");
    expect(list).toContain("/org-invite/");
    // a link shown for copying belongs to its own row and is cleared by any other action
    expect(actions).toContain("{shownLink && <input");
    expect((actions.match(/setShownLink\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(list).toContain("The link may have expired. Use Send again.");
    const page = src("app/(coach)/groups/[groupId]/branding/page.tsx");
    expect(page).toContain("loadPendingInvitees(createServiceRoleClient()");
    expect(page).toContain("members.filter((m) => !pendingIds.has(m.profileId))");
    expect(src("components/org/team-members-panel.tsx")).toContain("<InvitationsList ");
  });

  it("the form tells the person inviting when the email did not go out", () => {
    const form = src("components/coach/desktop/invite-coach-form.tsx");
    expect(form).toContain("data.emailed !== false");
    expect(form).toContain("the email did not go out");
  });

  it("the password reset and sign-in link emails are sent through the mail service when it is set up, with the same answer for any address", () => {
    const forgot = src("app/api/auth/forgot-password/route.ts");
    expect(forgot).toContain("if (isEmailConfigured())");
    expect(forgot).toContain('type: "recovery"');
    // inside the mail-service branch every outcome is the same ok
    const branch = forgot.slice(forgot.indexOf("if (isEmailConfigured())"), forgot.indexOf("const anon = createClient("));
    expect(branch).not.toMatch(/status: (4|5)\d\d/);
    // the lookup and the send happen after the answer, so an address with an account and one without take the same time
    expect(branch).toContain("after(async () => {");
    expect(branch.indexOf("makeAuthLink(")).toBeGreaterThan(branch.indexOf("after(async () => {"));
    expect(branch.indexOf("return NextResponse.json({ ok: true })")).toBeGreaterThan(branch.indexOf("after(async () => {"));
    expect(src("app/api/clients/send-signin-link/route.ts")).toContain('makeAuthLink(serviceRole, { type: "recovery"');
    expect(src("lib/resend-access.ts")).toContain("authUser?.email_confirmed_at && !isEmailConfigured()");
  });
});

describe("TC1b: one plain coach list at the top of the Clients page", () => {
  it("the page shows a Coaches section before the client content, in both the desktop and the phone layout, and the old small block is gone", () => {
    const page = src("app/(coach)/groups/[groupId]/clients/page.tsx");
    expect((page.match(/<CoachesSection /g) ?? []).length).toBe(2);
    expect(page).not.toContain("Coaching Staff");
    // desktop: right under the header, before the cards
    expect(page.indexOf("<CoachesSection ", page.indexOf('active="members"'))).toBeLessThan(page.indexOf("phaseAlignmentSummary && phaseAlignmentSummary.misaligned > 0 && ("));
    // phone: before the roster
    expect(page.lastIndexOf("<CoachesSection ", page.indexOf("<CoachRosterMobile "))).toBeGreaterThan(-1);
    expect(page).toContain("canManage={inviteManager.ok}");
    const roster = src("components/group/roster-list.tsx");
    // the coach looking at it is not listed (Oct 24); with nobody else the section is not drawn
    expect(roster).toContain("{!viewerIsCoach && staffShown.length > 0 && (");
    expect(roster).toContain('m.role === "coach" && !hidden.has(m.profileId)');
  });

  it("each coach shows name and role; the viewer is marked You; someone who has not accepted says so and has the three buttons only for an owner or admin; there is an Invite a coach button for them and a link to the Team page", () => {
    const s = src("components/coach/coaches-section.tsx");
    expect(s).toContain("You");
    expect(s).toContain("Invited, not accepted yet");
    expect(s).toContain("{canManage && c.profileId !== viewerId && c.orgRole !== \"owner\" && (");
    expect(s).toContain("{canManage && <InviteCoachForm groupId={groupId} />}");
    expect(s).toContain("Manage invitations on the Team page");
    expect(s).toContain("branding?tab=team");
  });

  it("the Coaches list data: every coach seat with the organization role, and the not-accepted ones found by the same footprint-checked rule as the Team page", () => {
    const lib = src("lib/pending-coaches.ts");
    expect(lib).toContain('.eq("role", "coach")');
    expect(lib).toContain("loadPendingInvitees(");
    expect(lib).toContain('coaches.filter((c) => c.orgRole !== "owner")');
    // never throws: a failed read lists nobody as pending
    expect(lib).toContain("catch {");
  });

  it("people who have not accepted are left out of the places that treat coaches as working: who an athlete can message, depth-chart scopes, revenue shares, the group home roster", () => {
    expect(src("app/(coach)/groups/[groupId]/messages/page.tsx")).toContain("!notAccepted.has(r.profile_id)");
    expect(src("app/(coach)/groups/[groupId]/team/page.tsx")).toContain("!notAccepted.has(c.profile_id)");
    expect(src("app/(coach)/groups/[groupId]/revenue-splits/page.tsx")).toContain("!notAccepted.has(m.profile_id)");
    // read in Home's first wave (phone speed B8)
    const home = src("app/(coach)/groups/[groupId]/page.tsx");
    expect(home).toContain("pendingCoachIds(params.groupId),");
    expect(home).toContain("hiddenProfileIds={[...pendingCoaches]}");
  });

  it("Settings has Coaches and invitations, pointing at the list and the Team page", () => {
    const settings = src("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(settings).toContain('label="Coaches and invitations"');
    expect(settings).toContain("See your coaches and invite one");
  });

  it("TC1c: the Clients link on a computer lands on /clients, so that coach-level page carries the same Coaches section at the top for every organization", () => {
    // the real path: the group's clients page sends a computer to /clients unless it is the explicit Members view of a team or social group
    const group = src("app/(coach)/groups/[groupId]/clients/page.tsx");
    expect(group).toContain('redirect(search.add === "1" ? "/clients?add=1" : "/clients")');
    expect(group).toContain("if (!showMembersView && !(await prefersAthleteStyleView()))");
    // the landing page itself
    const page = src("app/(coach)/clients/page.tsx");
    expect(page).toContain('import { CoachesSection } from "@/components/coach/coaches-section";');
    expect(page).toContain("loadOrgCoaches(anchor.id)");
    expect(page).toContain("authorizeInviteManager(supabase, user.id, anchor.id)");
    expect(page).toContain("<CoachesSection groupId={anchor.id} viewerId={user.id} coaches={coachList.coaches} pending={coachList.pending} canManage={inviteManager.ok} signIns={signIns} />");
    // above the client list, below the title row, and not behind a team-only condition
    expect(page.indexOf("<CoachesSection ")).toBeGreaterThan(page.indexOf("<AddClientButton "));
    expect(page.indexOf("<CoachesSection ")).toBeLessThan(page.indexOf("<CoachClientsList "));
    expect(page).not.toMatch(/&&s*<CoachesSection /);
    // a phone is sent to the group page, which has it too
    expect(page).toContain("redirect(`/groups/${anchor.id}/clients`)");
  });
});
