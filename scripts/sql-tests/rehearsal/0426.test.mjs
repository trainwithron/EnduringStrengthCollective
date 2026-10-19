// 0426 (SPEED migration A): the organization wall is asked once per query instead of once per row, and means exactly what group_in_active_org means (including the personal space, which belongs to
// no organization). For a coach in two organizations with a personal space, every header gives the same rows through the policy as group_in_active_org gives row by row.
const H = (g) => (g ? JSON.stringify({ "x-workspace-group": g }) : "");

export default {
  name: "0426 the organization wall, once per query",
  migrations: ["0426"],
  phases: {
    async "0426"({ db, h }) {
      const ownerA = await h.user("SB Owner A");
      const ownerB = await h.user("SB Owner B");
      const coach = await h.user("SB Coach Both");
      const orgA = await h.org(ownerA);
      const orgB = await h.org(ownerB);
      await h.orgMember(orgA, coach, "coach");
      await h.orgMember(orgB, coach, "coach");
      const gA = await h.group(orgA, coach, "team", "SB team A");
      const gB = await h.group(orgB, coach, "team", "SB team B");

      await h.asSuper();
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select true $$`);
      // a group with no organization (the personal space)
      const personal = (await db.query(`insert into public.groups (name, group_kind, organization_id, created_by) values ('SB personal', 'one_on_one', null, $1) returning id`, [coach])).rows[0].id;
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')`, [personal, coach]);
      await db.query("alter table public.programs disable trigger programs_guard_one_on_one");
      for (const [g, name] of [[gA, "SB program A"], [gB, "SB program B"], [personal, "SB program personal"]]) {
        await db.query(`insert into public.programs (group_id, name, created_by, is_active) values ($1, $2, $3, true)`, [g, name, coach]);
      }
      await db.query("alter table public.programs enable trigger programs_guard_one_on_one");

      const pol = await h.one(`select qual, with_check from pg_policies where schemaname = 'public' and tablename = 'programs' and policyname = 'org_wall_header'`);
      h.check("the programs wall now reads the set, not the per-row function", pol.qual.includes("active_org_group_ids()") && !pol.qual.includes("group_in_active_org(") && pol.with_check.includes("active_org_group_ids()"), JSON.stringify(pol));
      const left = await h.one(`select count(*)::int as n from pg_policies where schemaname = 'public' and policyname = 'org_wall_header' and qual = 'group_in_active_org(group_id)'`);
      h.check("no org_wall_header policy is left on the per-row function", left.n === 0, String(left.n));

      const throughPolicy = async (hdr) => {
        await h.as(coach);
        await db.query(`select set_config('request.headers', $1, false)`, [H(hdr)]);
        const r = (await db.query(`select name from public.programs where name like 'SB program%' order by name`)).rows.map((x) => x.name).join(",");
        await h.asSuper();
        return r;
      };
      const byFunction = async (hdr) => {
        await h.as(coach);
        await db.query(`select set_config('request.headers', $1, false)`, [H(hdr)]);
        // the same rows the coach can see, filtered by the old per-row rule instead
        const r = (await db.query(`select name from public.programs where name like 'SB program%' and public.group_in_active_org(group_id) order by name`)).rows.map((x) => x.name).join(",");
        await h.asSuper();
        return r;
      };
      for (const [label, hdr] of [["no header", null], ["organization A", gA], ["organization B", gB], ["the personal space", personal]]) {
        const a = await throughPolicy(hdr);
        const b = await byFunction(hdr);
        h.check(`${label}: the set-based wall shows exactly what group_in_active_org shows (${a})`, a === b && a.length > 0, `${a} | ${b}`);
      }
      h.check("organization A: A's program and the personal one, never B's", (await throughPolicy(gA)) === "SB program A,SB program personal");

      // Someone else's personal space: never in this coach's set, and its program stays invisible to them either way.
      const other = await h.user("SB Other Coach");
      await h.asSuper();
      const otherSpace = (await db.query(`insert into public.groups (name, group_kind, organization_id, created_by) values ('SB other personal', 'one_on_one', null, $1) returning id`, [other])).rows[0].id;
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')`, [otherSpace, other]);
      await db.query("alter table public.programs disable trigger programs_guard_one_on_one");
      await db.query(`insert into public.programs (group_id, name, created_by, is_active) values ($1, 'SB other program', $2, true)`, [otherSpace, other]);
      await db.query("alter table public.programs enable trigger programs_guard_one_on_one");
      await h.as(coach);
      await db.query(`select set_config('request.headers', $1, false)`, [H(gA)]);
      const ids = (await db.query(`select public.active_org_group_ids() as id`)).rows.map((x) => x.id);
      h.check("the set holds the named organization's groups and the caller's OWN personal space, never anyone else's", ids.includes(gA) && ids.includes(personal) && !ids.includes(otherSpace) && !ids.includes(gB), JSON.stringify(ids));
      const seen = (await db.query(`select count(*)::int as n from public.programs where name = 'SB other program'`)).rows[0].n;
      h.check("someone else's personal-space program stays invisible", seen === 0, String(seen));
      await h.asSuper();

      await h.as(coach);
      await db.query(`select set_config('request.headers', $1, false)`, [H(gA)]);
      await h.expectError("naming A, the coach still cannot write into B", async () => {
        await db.query(`insert into public.programs (group_id, name, created_by, is_active) values ($1, 'SB sneak', $2, false)`, [gB, coach]);
      }, /row-level security|violates|policy/i);
      await h.asSuper();
    },
  },
};
