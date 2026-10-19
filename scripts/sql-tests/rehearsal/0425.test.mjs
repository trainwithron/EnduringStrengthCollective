// 0425: the organization wall follows the organization the person CHOSE (x-workspace-org) when they belong to it; otherwise (no such header, not a uuid, an organization they are not in) it falls back to
// the group header exactly as before. One organization value everywhere: opening another organization's group page no longer moves the whole app.
const H = (o) => JSON.stringify(o);

export default {
  name: "0425 the organization wall follows the chosen organization",
  migrations: ["0425"],
  phases: {
    async "0425"({ db, h }) {
      const ownerA = await h.user("OV Owner A");
      const ownerB = await h.user("OV Owner B");
      const ownerC = await h.user("OV Owner C");
      const coach = await h.user("OV Coach Both");
      const orgA = await h.org(ownerA);
      const orgB = await h.org(ownerB);
      const orgC = await h.org(ownerC);
      await h.orgMember(orgA, coach, "coach");
      await h.orgMember(orgB, coach, "coach");
      const gA = await h.group(orgA, coach, "team", "OV team A");
      const gB = await h.group(orgB, coach, "team", "OV team B");
      const gC = await h.group(orgC, ownerC, "team", "OV team C");

      await h.asSuper();
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select true $$`);
      await db.query("alter table public.programs disable trigger programs_guard_one_on_one");
      for (const [g, name, by] of [[gA, "OV program A", coach], [gB, "OV program B", coach], [gC, "OV program C", ownerC]]) {
        await db.query(`insert into public.programs (group_id, name, created_by, is_active) values ($1, $2, $3, true)`, [g, name, by]);
      }
      await db.query("alter table public.programs enable trigger programs_guard_one_on_one");

      const setHeader = (o) => db.query(`select set_config('request.headers', $1, false)`, [o ? H(o) : ""]);
      const names = async () => (await db.query(`select name from public.programs where name like 'OV program%' order by name`)).rows.map((r) => r.name).join(",");
      const org = async () => (await db.query(`select public.request_workspace_org() as o`)).rows[0].o;

      await h.as(coach);
      await setHeader({ "x-workspace-org": orgA });
      h.check("the chosen organization (A) is the wall, with no group header", (await org()) === orgA && (await names()) === "OV program A", await names());

      await setHeader({ "x-workspace-org": orgA, "x-workspace-group": gB });
      h.check("the chosen organization wins over the last group opened (a group of B)", (await org()) === orgA && (await names()) === "OV program A", await names());

      await setHeader({ "x-workspace-org": orgB, "x-workspace-group": gB });
      h.check("choosing B shows B", (await org()) === orgB && (await names()) === "OV program B", await names());

      await setHeader({ "x-workspace-org": orgC, "x-workspace-group": gA });
      h.check("an organization the person does not belong to is ignored: the group header decides, as before", (await org()) === orgA && (await names()) === "OV program A", await names());

      await setHeader({ "x-workspace-org": "not-a-uuid", "x-workspace-group": gB });
      h.check("a value that is not an organization id is ignored: the group header decides", (await org()) === orgB, String(await org()));

      await setHeader({ "x-workspace-group": gA });
      h.check("no organization header: exactly as before (the group header)", (await org()) === orgA && (await names()) === "OV program A");

      await setHeader(null);
      h.check("no header at all: no wall (both organizations, as before)", (await org()) === null && (await names()) === "OV program A,OV program B", await names());

      // a coach with only a seat in a group of B (no organization membership) still counts as belonging to B
      const seatOnly = await h.user("OV Seat Only");
      await h.asSuper();
      await h.member(gB, seatOnly, "coach");
      await h.as(seatOnly);
      await setHeader({ "x-workspace-org": orgB });
      h.check("a seat in one of the organization's groups is enough to choose it", (await org()) === orgB);

      // a stranger naming an organization gets nothing from it
      const stranger = await h.user("OV Stranger");
      await h.as(stranger);
      await setHeader({ "x-workspace-org": orgA });
      h.check("a stranger naming organization A: no wall from it, and still none of A's rows", (await org()) === null && (await names()) === "", await names());

      // switched off: nothing (as before)
      await h.asSuper();
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select false $$`);
      await h.as(coach);
      await setHeader({ "x-workspace-org": orgA });
      h.check("with the wall switched off the header changes nothing", (await org()) === null);
      await h.asSuper();
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select true $$`);
    },
  },
};
