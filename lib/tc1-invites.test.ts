import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { inviteEmail, makeAuthLink, recoveryEmail, sendAuthMail } from "./auth-mail";
import { authorizeInviteManager, isUnaccepted, loadInviteTarget, loadPendingInvitees } from "./coach-invite-server";

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
    expect(m.text).toMatch(/works once/);
    expect(inviteEmail({ toName: "", orgName: "O", inviterName: null, role: "front_desk", link: "l" }).text).toContain("front desk staff");
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
    expect(isUnaccepted({ email_confirmed_at: null, last_sign_in_at: null })).toBe(true);
    expect(isUnaccepted({ email_confirmed_at: "2026-10-01", last_sign_in_at: null })).toBe(false);
    expect(isUnaccepted({ email_confirmed_at: null, last_sign_in_at: "2026-10-01" })).toBe(false);
    expect(isUnaccepted(null)).toBe(false);
  });

  function adminDb(users: Record<string, { email: string; email_confirmed_at: string | null; last_sign_in_at: string | null; invited_at?: string }>, tables: { members?: Record<string, string>; desk?: string[] }) {
    return {
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] ? { id, ...users[id] } : null } }) } },
      from: (table: string) => {
        const filters: Record<string, string> = {};
        const b: any = {
          select: () => b,
          eq: (col: string, val: string) => ((filters[col] = val), b),
          maybeSingle: async () => {
            if (table === "organization_memberships") return { data: tables.members?.[filters.profile_id] ? { role: tables.members[filters.profile_id] } : null };
            if (table === "org_front_desk") return { data: tables.desk?.includes(filters.profile_id) ? { profile_id: filters.profile_id } : null };
            if (table === "profiles") return { data: { full_name: "Cade Thompson" } };
            return { data: null };
          },
        };
        return b;
      },
    };
  }

  it("lists the unaccepted among the people given, newest first, and leaves out anyone accepted or unreadable", async () => {
    const db = adminDb(
      {
        a: { email: "a@x.co", email_confirmed_at: null, last_sign_in_at: null, invited_at: "2026-10-16T17:00:00Z" },
        b: { email: "b@x.co", email_confirmed_at: "2026-10-01", last_sign_in_at: "2026-10-02" },
        c: { email: "c@x.co", email_confirmed_at: null, last_sign_in_at: null, invited_at: "2026-10-17T09:00:00Z" },
      },
      {}
    );
    const list = await loadPendingInvitees(db, [
      { profileId: "a", name: "Cade", role: "admin" },
      { profileId: "b", name: "Bea", role: "coach" },
      { profileId: "c", name: "Dee", role: "front_desk" },
      { profileId: "missing", name: "Ghost", role: "coach" },
    ]);
    expect(list.map((p) => p.profileId)).toEqual(["c", "a"]);
    expect(list[1]).toMatchObject({ name: "Cade", email: "a@x.co", role: "admin", sentAt: "2026-10-16T17:00:00Z" });
  });

  it("a target must belong to the organization, must not be the owner and must not have accepted", async () => {
    const users = {
      p1: { email: "p1@x.co", email_confirmed_at: null, last_sign_in_at: null },
      p2: { email: "p2@x.co", email_confirmed_at: "2026-10-01", last_sign_in_at: null },
      own: { email: "own@x.co", email_confirmed_at: null, last_sign_in_at: null },
      desk: { email: "d@x.co", email_confirmed_at: null, last_sign_in_at: null },
    };
    const db = adminDb(users, { members: { p1: "coach", p2: "admin", own: "owner" }, desk: ["desk"] });
    expect(await loadInviteTarget(db, "org", "p1")).toMatchObject({ ok: true, email: "p1@x.co", role: "coach" });
    expect(await loadInviteTarget(db, "org", "desk")).toMatchObject({ ok: true, role: "front_desk" });
    expect(await loadInviteTarget(db, "org", "stranger")).toMatchObject({ ok: false, status: 404 });
    expect(await loadInviteTarget(db, "org", "own")).toMatchObject({ ok: false, status: 404 });
    expect(await loadInviteTarget(db, "org", "p2")).toMatchObject({ ok: false, status: 409 });
    expect(await loadInviteTarget(db, "org", "")).toMatchObject({ ok: false, status: 400 });
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
    expect(route).not.toContain("inviteUserByEmail");
    expect(route).toContain('makeAuthLink(serviceRole, { type: "invite"');
    expect(route).toContain("sendAuthMail(");
    expect(route).toContain("{ invited: true, emailed }");
    expect(route).toContain("{ invited: true, emailed: sent.emailed }");
    // the neutral answer for a person who is already a member is unchanged
    expect(route).toContain("if (already) return NextResponse.json({ invited: true });");
  });

  it("Send again, Copy link and Cancel are owner/admin only, rate limited, and only for a person of this organization who has not accepted", () => {
    for (const name of ["resend", "link", "cancel"]) {
      const route = src(`app/api/coaches/invite/${name}/route.ts`);
      expect(route, name).toContain("authorizeInviteManager(supabase, user.id, groupId)");
      expect(route, name).toContain("loadInviteTarget(db, ");
      expect(route, name).toContain("rateLimitResponse(");
    }
    expect(src("app/api/coaches/invite/link/route.ts")).toContain('"cache-control": "no-store"');
    const cancel = src("app/api/coaches/invite/cancel/route.ts");
    expect(cancel).toContain("auth.admin.deleteUser(profileId)");
    // the account is deleted only when nothing else belongs to it
    expect(cancel.indexOf("(seats ?? 0) === 0")).toBeLessThan(cancel.indexOf("deleteUser"));
  });

  it("the Team page lists every invitation with who, role, status and the three actions, for both kinds", () => {
    const list = src("components/org/invitations-list.tsx");
    for (const word of ["Not accepted yet", "Send again", "Copy link", "Cancel", "Invitations"]) expect(list).toContain(word);
    expect(list).toContain("/api/coaches/invite/resend");
    expect(list).toContain("/api/coaches/invite/link");
    expect(list).toContain("/api/coaches/invite/cancel");
    expect(list).toContain("/org-invite/");
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
    expect(src("app/api/clients/send-signin-link/route.ts")).toContain('makeAuthLink(serviceRole, { type: "recovery"');
    expect(src("lib/resend-access.ts")).toContain("authUser?.email_confirmed_at && !isEmailConfigured()");
  });
});
