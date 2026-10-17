// 0390: a whole history import can be undone as one batch. The column is nullable, so every existing workout is unaffected.
export default {
  name: "0390 Import batch undo",
  migrations: ["0390"],
  phases: {
    async "0390"({ db, h }) {
      const coach = await h.user("IB Coach");
      const a1 = await h.user("IB Client");
      const org = await h.org(coach);
      const g1 = await h.group(org, coach, "team", "IB team");
      await h.member(g1, a1);
      await h.asSuper();
      const batch = "11111111-1111-1111-1111-111111111111";
      const mk = async (batchId, historical) =>
        (await db.query(`insert into public.athlete_sessions (group_id, athlete_id, status, started_at, completed_at, is_historical, import_batch_id) values ($1, $2, 'completed', now() - interval '40 days', now() - interval '40 days', $3, $4) returning id`, [g1, a1, historical, batchId])).rows[0].id;
      await mk(batch, true);
      await mk(batch, true);
      await mk(null, true);
      await mk(null, false);
      const col = await db.query(`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id'`);
      h.check("the batch column exists and may be empty", col.rows[0]?.is_nullable === "YES");
      await h.as(coach);
      await db.query(`delete from public.athlete_sessions where import_batch_id = $1 and is_historical and athlete_id = $2`, [batch, a1]);
      await h.asSuper();
      const left = await db.query(`select count(*)::int as n, count(*) filter (where import_batch_id is null)::int as unbatched from public.athlete_sessions where athlete_id = $1`, [a1]);
      h.check("undoing a batch removes exactly that batch and leaves other workouts", left.rows[0].n === 2 && left.rows[0].unbatched === 2, JSON.stringify(left.rows[0]));
    },
  },
};
