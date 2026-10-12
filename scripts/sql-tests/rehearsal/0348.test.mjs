// 0348/0349: defense in depth. A coach who is a coach in TWO organizations, with the request naming the workspace of one of them, sees and changes only that organization's rows; with no header (or a
// header that is not a group id) nothing changes; the switch (0349) is what turns it on. The group list, memberships and organizations stay visible so the switcher and the chooser keep working.
const HEADER = (groupId) => JSON.stringify({ "x-workspace-group": groupId });

export default {
  name: "0348 defense in depth: the request names a workspace and the database holds the line",
  migrations: ["0348", "0349"],
  phases: {
    async "0348"({ db, h }) {
      const ownerA = await h.user("DD Owner A");
      const ownerB = await h.user("DD Owner B");
      const coach = await h.user("DD Coach Both");
      const clientA = await h.user("DD Client A");
      const clientB = await h.user("DD Client B");
      const orgA = await h.org(ownerA);
      const orgB = await h.org(ownerB);
      await h.orgMember(orgA, coach, "coach");
      await h.orgMember(orgB, coach, "coach");
      const gA = await h.group(orgA, coach, "team", "DD team A");
      const gB = await h.group(orgB, coach, "team", "DD team B");
      await h.member(gA, clientA);
      await h.member(gB, clientB);

      await h.asSuper();
      await db.query("alter table public.programs disable trigger programs_guard_one_on_one");
      const prog = async (g, name) => (await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active) values ($1, $2, $3, null, true) returning id`, [g, name, coach])).rows[0].id;
      await prog(gA, "DD program A");
      await prog(gB, "DD program B");
      await db.query("alter table public.programs enable trigger programs_guard_one_on_one");
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'DD msg A'), ($4, $2, $5, 'DD msg B')`, [gA, coach, clientA, gB, clientB]);

      const setHeader = (v) => db.query(`select set_config('request.headers', $1, false)`, [v]);
      const count = async (table, where = "true") => (await db.query(`select count(*)::int as n from public.${table} where ${where}`)).rows[0].n;

      // ---- installed but OFF: the header changes nothing -------------------------------------------------
      await h.as(coach);
      await setHeader(HEADER(gA));
      h.check("installed but switched off: a header naming organization A still shows both organizations' programs", (await count("programs", "name like 'DD program%'")) === 2);
      await setHeader("");

      // ---- switch it on (the 0349 step) ------------------------------------------------------------------
      await h.asSuper();
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select true $$`);

      await h.as(coach);
      h.check("no header: a coach in two organizations sees both (as before)", (await count("programs", "name like 'DD program%'")) === 2);
      await setHeader(HEADER(gA));
      h.check("header names organization A: only A's program", (await count("programs", "name like 'DD program%'")) === 1 && (await count("programs", "name = 'DD program A'")) === 1);
      h.check("...and only A's messages", (await count("direct_messages", "body like 'DD msg%'")) === 1 && (await count("direct_messages", "body = 'DD msg A'")) === 1);
      await h.expectError("...and the coach cannot write a program into organization B while naming A", async () => {
        await db.query(`insert into public.programs (group_id, name, created_by, is_active) values ($1, 'DD sneak', $2, false)`, [gB, coach]);
      }, /row-level security|violates|policy/i);
      await db.query(`insert into public.programs (group_id, name, created_by, is_active) values ($1, 'DD ok A', $2, false)`, [gA, coach]);
      h.check("...but can write into organization A", (await count("programs", "name = 'DD ok A'")) === 1);
      h.check("the group list, memberships and organizations stay visible (the switcher keeps working)",
        (await count("group_memberships", `profile_id = '${coach}'`)) === 2 && (await count("groups", `id in ('${gA}', '${gB}')`)) === 2);

      await setHeader(HEADER(gB));
      h.check("header names organization B: only B's program", (await count("programs", "name = 'DD program B'")) === 1 && (await count("programs", "name = 'DD program A'")) === 0);

      await setHeader(HEADER("not-a-group-id"));
      h.check("a header that is not a group id is ignored", (await count("programs", "name like 'DD program%'")) === 2);
      await setHeader(HEADER("00000000-0000-0000-0000-00000000dead"));
      h.check("a header naming a group that does not exist is ignored", (await count("programs", "name like 'DD program%'")) === 2);
      await setHeader("");

      // A header can only narrow: naming an organization the person has nothing in shows them nothing of it.
      const outsider = await h.user("DD Outsider");
      await h.as(outsider);
      await setHeader(HEADER(gA));
      h.check("a stranger naming organization A still sees none of it", (await count("programs", "name like 'DD program%'")) === 0);
      await setHeader("");

      // The client of A (one organization) is unaffected either way.
      await h.as(clientA);
      await setHeader(HEADER(gA));
      h.check("a client of A, header A: sees their team's program", (await count("programs", "name = 'DD program A'")) === 1);
      await setHeader(HEADER(gB));
      h.check("a client of A, header B: sees nothing of A", (await count("programs", "name = 'DD program A'")) === 0);
      await setHeader("");

      // The service role is not narrowed.
      await h.asService();
      await setHeader(HEADER(gA));
      h.check("the service role reads both organizations whatever the header says", (await count("programs", "name like 'DD program%'")) === 2);
      await setHeader("");

      // Every table whose rows belong to a group carries the rule (a new such table must be added, or listed here as left out on purpose).
      await h.asSuper();
      const missing = (await db.query(`
        select c.table_name from information_schema.columns c
        join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace and k.relkind = 'r' and k.relrowsecurity
        where c.table_schema = 'public' and c.column_name = 'group_id' and c.table_name not in ('group_memberships', 'group_invites')
          and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name and p.policyname = 'org_wall_header')`)).rows.map((r) => r.table_name);
      h.check("every table with a group_id carries the org_wall_header rule, except the two that list a person's own organizations" + (missing.length ? " (missing: " + missing.join(", ") + ")" : ""), missing.length === 0);
    },
  },
};
