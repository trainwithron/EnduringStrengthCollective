import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkInMessage, isFrontDeskPerson, landsOnFrontDesk, FRONT_DESK_PATH } from "./front-desk";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// A stand-in database: the front-desk table and the organization memberships, each answering (or failing, or throwing) on its own.
type Table = { rows: unknown[] | null; error?: unknown; throws?: boolean };
const db = (tables: { org_front_desk: Table; organization_memberships?: Table }) =>
  ({
    from: (name: "org_front_desk" | "organization_memberships") => ({
      select: () => ({
        eq: () => ({
          limit: async () => {
            const t = tables[name] ?? { rows: [] };
            if (t.throws) throw new Error("x");
            return { data: t.rows, error: t.error ?? null };
          },
        }),
      }),
    }),
  }) as never;

const DESK = { rows: [{ organization_id: "o1" }] };
const NONE = { rows: [] };

describe("who lands on the front-desk screen", () => {
  it("only a person whose ONLY role is the front desk does", async () => {
    expect(await isFrontDeskPerson(db({ org_front_desk: DESK }), "u")).toBe(true);
    expect(await landsOnFrontDesk(db({ org_front_desk: DESK, organization_memberships: NONE }), "u", null)).toBe(true);
  });

  it("not a coach, not a client, and not an owner, admin or coach of an organization", async () => {
    expect(await landsOnFrontDesk(db({ org_front_desk: DESK, organization_memberships: NONE }), "u", { role: "coach" })).toBe(false);
    expect(await landsOnFrontDesk(db({ org_front_desk: DESK, organization_memberships: NONE }), "u", { role: "athlete" })).toBe(false);
    expect(await landsOnFrontDesk(db({ org_front_desk: DESK, organization_memberships: { rows: [{ organization_id: "o1" }] } }), "u", null)).toBe(false);
  });

  it("nobody else does, and a failed read lands them where they always landed", async () => {
    expect(await landsOnFrontDesk(db({ org_front_desk: NONE, organization_memberships: NONE }), "u", null)).toBe(false);
    expect(await landsOnFrontDesk(db({ org_front_desk: { rows: null, error: { message: "x" } } }), "u", null)).toBe(false);
    expect(await landsOnFrontDesk(db({ org_front_desk: { rows: null, throws: true } }), "u", null)).toBe(false);
    expect(await landsOnFrontDesk(db({ org_front_desk: DESK, organization_memberships: { rows: null, error: { message: "x" } } }), "u", null)).toBe(false);
    expect(await landsOnFrontDesk(db({ org_front_desk: DESK, organization_memberships: { rows: null, throws: true } }), "u", null)).toBe(false);
  });

  it("sign-in, the home page, the first-password page and email confirmation all use that one rule", () => {
    for (const f of ["app/login/page.tsx", "app/page.tsx", "app/set-password/page.tsx", "app/confirm-email/page.tsx"]) {
      expect(src(f), f).toContain("landsOnFrontDesk(");
      expect(src(f), f).toContain("FRONT_DESK_PATH");
    }
    expect(FRONT_DESK_PATH).toBe("/front-desk");
  });

  it("everyone else can still reach the screen: a Front desk link in the menu, in Settings, and on the Team page", () => {
    expect(src("components/coach/coach-desktop-shell.tsx")).toContain('{ key: "front-desk" as const, label: "Front desk", href: "/front-desk"');
    expect(src("components/coach/coach-desktop-shell.tsx")).toContain("useOnFrontDesk()");
    expect(src("components/front-desk/use-on-front-desk.ts")).toContain('.from("org_front_desk")');
    expect(src("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain('href="/front-desk"');
    expect(src("components/org/front-desk-list.tsx")).toContain("/front-desk?org=");
  });
});

describe("the check-in answers", () => {
  it("each has its own plain words", () => {
    expect(checkInMessage("wrong")).toMatch(/not right/);
    expect(checkInMessage("locked")).toMatch(/Too many wrong tries/);
    expect(checkInMessage("throttled")).toMatch(/Wait a few minutes/);
    expect(checkInMessage("no_pin")).toMatch(/No check-in code/);
    expect(checkInMessage("anything else")).toMatch(/Couldn't check in/);
  });
});

describe("the front desk reaches clients only through the database's functions", () => {
  it("the screen asks for names and check-ins by function and never reads a clients table", () => {
    const screen = src("components/front-desk/front-desk-screen.tsx");
    expect(screen).toContain('.rpc("front_desk_find"');
    expect(screen).toContain('.rpc("front_desk_check_in"');
    expect(screen).not.toMatch(/\.from\(/);
    const page = src("app/front-desk/page.tsx");
    expect(page).toContain('rpc("front_desk_orgs")');
    expect(page).not.toMatch(/\.from\(/);
  });

  it("the screen shows exactly the name the database sent (shortened for anyone under 18 or of unknown age), on the list, the code screen and the confirmation", () => {
    const screen = src("components/front-desk/front-desk-screen.tsx");
    expect(screen).not.toContain("full_name");
    expect(screen.match(/display_name/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("the migration keeps the front desk out of every organization-wide rule: its own table, no organization role, no group seat", () => {
    const sql = src("supabase/migrations/0400_front_desk.sql");
    expect(sql).toContain("create table if not exists public.org_front_desk");
    expect(sql).not.toContain("alter type public.org_member_role");
    expect(sql).toMatch(/revoke all on public\.org_front_desk from anon, authenticated;\ngrant select on public\.org_front_desk to authenticated;/);
    // accepting a front-desk invitation writes the front-desk row and not the membership
    const accept = sql.slice(sql.indexOf("if p_accept and inv.role = 'front_desk' then"));
    expect(accept.indexOf("insert into public.org_front_desk")).toBeGreaterThan(-1);
    expect(accept.indexOf("insert into public.org_front_desk")).toBeLessThan(accept.indexOf("insert into public.organization_memberships"));
    // the coach's own code test keeps its coach-only guard
    expect(sql).toContain("if auth.uid() is null or not public.is_group_coach(p_group_id) then");
  });

  it("an ordinary coach is held to groups they coach, in the search and in the check-in", () => {
    const sql = src("supabase/migrations/0400_front_desk.sql");
    expect(sql).toContain("and (v_scope = 'all' or public.is_group_coach(m.group_id))");
    expect(sql).toContain("if v_scope <> 'all' and not public.is_group_coach(p_group) then");
  });

  it("the search matches the shortened name, never the full name of a minor", () => {
    const sql = src("supabase/migrations/0400_front_desk.sql");
    expect(sql).toContain("where s.shown ilike");
    expect(sql).toContain("_front_desk_display_name(p.full_name, ci.date_of_birth)");
    expect(sql).toContain("p_dob is not null and p_dob + interval '18 years' <= current_date");
  });

  it("access that has ended, and a closed organization, end the front desk's reach", () => {
    const sql = src("supabase/migrations/0400_front_desk.sql");
    expect(sql).toContain("om.fired_at is null and om.access_ended_at is null");
    expect(sql).toContain("delete from public.org_front_desk where organization_id = p_org;");
    expect(sql).toContain("using (profile_id = (select auth.uid()) or public.is_org_active_owner_or_admin(organization_id));");
  });

  it("wrong codes are limited per person (10 in 15 minutes), on top of each client's own lock", () => {
    const sql = src("supabase/migrations/0400_front_desk.sql");
    expect(sql).toContain("interval '15 minutes') >= 10 then");
    expect(sql).toContain("jsonb_build_object('result', 'throttled')");
    // the try that locks a client counts too
    expect(sql).toContain("if v_verdict in ('wrong', 'locked') then");
    expect(sql).not.toMatch(/_front_desk_display_name[\s\S]{0,200}immutable/);
  });

  it("the invitation route makes a front-desk row, never a membership or a group seat, for the new role", () => {
    const route = src("app/api/coaches/invite/route.ts");
    expect(route).toContain('"front_desk"');
    expect(route).toContain('.from("org_front_desk").insert(');
    const frontDeskBranch = route.slice(route.indexOf('if (role === "front_desk") {'));
    expect(frontDeskBranch.indexOf("return NextResponse.json({ invited: true });")).toBeLessThan(frontDeskBranch.indexOf('.from("group_memberships")'));
  });

  it("the answer to an invitation is the same whether or not an account or an open invitation exists; the form points at the Invitations list", () => {
    const route = src("app/api/coaches/invite/route.ts");
    expect(route).not.toContain("invite_open");
    expect(route).not.toContain("status: 409");
    expect(route).toContain('if (inviteRowError?.code === "23505") return NextResponse.json({ invited: true });');
    expect(src("components/coach/desktop/invite-coach-form.tsx")).toContain("choose Resend there");
  });

  it("the front-desk link is asked per person and a signed-out or failed read is never kept", () => {
    const hook = src("components/front-desk/use-on-front-desk.ts");
    expect(hook).toContain("kept.userId === user.id");
    expect(hook).toContain("if (!user) return false;");
    expect(hook.indexOf("if (error) return false;")).toBeLessThan(hook.indexOf("kept = {"));
    expect(hook).not.toContain("asked ??=");
  });

  it("only an owner or admin reaches the invitation and the removal buttons", () => {
    const page = src("app/(coach)/groups/[groupId]/branding/page.tsx");
    expect(page).toContain("canManage={isOwnerOrAdmin}");
    expect(page).toContain("profiles!org_front_desk_profile_id_fkey");
  });
});
