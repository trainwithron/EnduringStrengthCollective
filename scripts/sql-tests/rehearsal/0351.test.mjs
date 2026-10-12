// 0351: Duplicate makes an unassigned library program. A plain duplicate (no client) comes out NOT active, in the same group or another; a copy made for one client is live as before.
export default {
  name: "0351 Duplicate makes an unassigned library program",
  migrations: ["0351"],
  phases: {
    async "0351"({ db, h }) {
      const owner = await h.user("DL Owner");
      const coach = await h.user("DL Coach");
      const client = await h.user("DL Client");
      const org = await h.org(owner);
      await h.orgMember(org, coach, "coach");
      const team = await h.group(org, coach, "team", "DL team");
      const team2 = await h.group(org, coach, "team", "DL team 2");
      await h.member(team, client);

      await h.asSuper();
      await db.query("alter table public.programs disable trigger programs_guard_one_on_one");
      const src = (await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active) values ($1, 'DL source', $2, null, true) returning id`, [team, coach])).rows[0].id;
      await db.query("alter table public.programs enable trigger programs_guard_one_on_one");

      await h.as(coach);
      const same = (await db.query(`select public.duplicate_program($1, $2, $3, null, null, null) as id`, [src, team, coach])).rows[0].id;
      const other = (await db.query(`select public.duplicate_program($1, $2, $3, null, null, null) as id`, [src, team2, coach])).rows[0].id;
      const mine = (await db.query(`select public.duplicate_program($1, $2, $3, $4, 'DL Client', null) as id`, [src, team, coach, client])).rows[0].id;
      const row = async (id) => (await db.query(`select is_active, athlete_id from public.programs where id = $1`, [id])).rows[0];
      const a = await row(same);
      h.check("a plain Duplicate in the same group is not active (it is in the library)", a.is_active === false && a.athlete_id === null);
      const b = await row(other);
      h.check("a plain Duplicate into another group is not active either", b.is_active === false && b.athlete_id === null);
      const c = await row(mine);
      h.check("a copy made for one client is live as before", c.is_active === true && c.athlete_id === client);
      h.check("the original is untouched", (await row(src)).is_active === true);
    },
  },
};
