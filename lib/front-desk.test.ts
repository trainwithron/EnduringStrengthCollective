import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkInMessage, isFrontDeskPerson, landsOnFrontDesk, FRONT_DESK_PATH } from "./front-desk";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const client = (rows: unknown[] | null, error: unknown = null, throws = false) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => {
            if (throws) throw new Error("x");
            return { data: rows, error };
          },
        }),
      }),
    }),
  }) as never;

describe("who lands on the front-desk screen", () => {
  it("a front-desk person who is not a coach does; a coach does not, even if also on the front desk", async () => {
    const desk = client([{ organization_id: "o1" }]);
    expect(await isFrontDeskPerson(desk, "u")).toBe(true);
    expect(await landsOnFrontDesk(desk, "u", null)).toBe(true);
    expect(await landsOnFrontDesk(desk, "u", { role: "athlete" })).toBe(true);
    expect(await landsOnFrontDesk(desk, "u", { role: "coach" })).toBe(false);
  });

  it("nobody else does, and a failed read lands them where they always landed", async () => {
    expect(await landsOnFrontDesk(client([]), "u", null)).toBe(false);
    expect(await landsOnFrontDesk(client(null, { message: "x" }), "u", null)).toBe(false);
    expect(await landsOnFrontDesk(client(null, null, true), "u", { role: "athlete" })).toBe(false);
  });

  it("sign-in, the home page, the first-password page and email confirmation all use that one rule", () => {
    for (const f of ["app/login/page.tsx", "app/page.tsx", "app/set-password/page.tsx", "app/confirm-email/page.tsx"]) {
      expect(src(f), f).toContain("landsOnFrontDesk(");
      expect(src(f), f).toContain("FRONT_DESK_PATH");
    }
    expect(FRONT_DESK_PATH).toBe("/front-desk");
  });
});

describe("the check-in answers", () => {
  it("each has its own plain words", () => {
    expect(checkInMessage("wrong")).toMatch(/not right/);
    expect(checkInMessage("locked")).toMatch(/Too many wrong tries/);
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

  it("the invitation route makes a front-desk row, never a membership or a group seat, for the new role", () => {
    const route = src("app/api/coaches/invite/route.ts");
    expect(route).toContain('"front_desk"');
    expect(route).toContain('.from("org_front_desk").insert(');
    const frontDeskBranch = route.slice(route.indexOf('if (role === "front_desk") {'));
    expect(frontDeskBranch.indexOf("return NextResponse.json({ invited: true });")).toBeLessThan(frontDeskBranch.indexOf('.from("group_memberships")'));
  });

  it("only an owner or admin reaches the invitation and the removal buttons", () => {
    const page = src("app/(coach)/groups/[groupId]/branding/page.tsx");
    expect(page).toContain("canManage={isOwnerOrAdmin}");
    expect(page).toContain("profiles!org_front_desk_profile_id_fkey");
  });
});
