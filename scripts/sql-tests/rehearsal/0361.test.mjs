// 0361: the shared exercise catalog. Everyone signed in reads it; only the platform admin writes it; an anonymous caller reads nothing. A coach's own library row can be linked to a catalog entry.
export default {
  name: "0361 shared exercise catalog: read for everyone signed in, write for the platform admin only",
  migrations: ["0361"],
  phases: {
    async "0361"({ db, h }) {
      const admin = await h.platformAdmin("EC Admin");
      const coach = await h.user("EC Coach");
      const stranger = await h.user("EC Stranger");

      await h.as(admin);
      const made = await db.query(`insert into public.exercise_catalog (name, category, equipment) values ('EC Barbell Back Squat', 'Legs', 'barbell') returning id`);
      h.check("the platform admin can add a catalog entry", made.rows.length === 1);
      const catalogId = made.rows[0].id;
      await db.query(`insert into public.exercise_catalog_aliases (alias_key, catalog_id, alias) values ('ecbacksquat', $1, 'EC Back Squat')`, [catalogId]);
      h.check("...and a spelling of it", (await db.query(`select count(*)::int as n from public.exercise_catalog_aliases`)).rows[0].n === 1);

      for (const [label, who] of [["a coach", coach], ["another signed-in person", stranger]]) {
        await h.as(who);
        h.check(`${label} can read the catalog and its spellings`, (await db.query(`select count(*)::int as n from public.exercise_catalog`)).rows[0].n === 1 && (await db.query(`select count(*)::int as n from public.exercise_catalog_aliases`)).rows[0].n === 1);
        await h.expectError(`${label} cannot add a catalog entry`, () => db.query(`insert into public.exercise_catalog (name) values ('EC Sneaky')`), /row-level security|permission denied/);
        await h.expectError(`${label} cannot add a spelling`, () => db.query(`insert into public.exercise_catalog_aliases (alias_key, catalog_id, alias) values ('ecsneaky', $1, 'EC Sneaky')`, [catalogId]), /row-level security|permission denied/);
        const changed = await db.query(`update public.exercise_catalog set name = 'EC Renamed' where id = $1`, [catalogId]);
        h.check(`${label} cannot rename an entry (no row changes)`, (changed.rowCount ?? 0) === 0);
        const removed = await db.query(`delete from public.exercise_catalog where id = $1`, [catalogId]);
        h.check(`${label} cannot delete an entry (no row is removed)`, (removed.rowCount ?? 0) === 0);
      }

      await h.as(null);
      let anon = 0;
      try {
        anon = (await db.query(`select count(*)::int as n from public.exercise_catalog`)).rows[0].n;
      } catch {
        anon = 0;
      }
      h.check("an anonymous caller reads nothing", anon === 0);

      await h.as(coach);
      await db.query(`insert into public.exercise_library (created_by, name) values ($1, 'EC Back Squat')`, [coach]);
      const linked = await db.query(`update public.exercise_library set catalog_id = $1 where created_by = $2 and name = 'EC Back Squat'`, [catalogId, coach]);
      h.check("a coach can link their own library entry to a catalog entry", (linked.rowCount ?? 0) === 1);
      await h.as(admin);
      await db.query(`delete from public.exercise_catalog where id = $1`, [catalogId]);
      await h.asSuper();
      h.check("deleting a catalog entry only unlinks the coach's library entry", (await db.query(`select count(*)::int as n from public.exercise_library where created_by = $1 and name = 'EC Back Squat' and catalog_id is null`, [coach])).rows[0].n === 1);
    },
  },
};
