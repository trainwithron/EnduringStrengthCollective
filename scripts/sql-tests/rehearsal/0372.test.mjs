// 0372: imported history counts. The totals, graphs and records are read from the sets (client_exercise_rollup), counting only sets that are not an unclear data point; training maxes are rebuilt
// from the sets that count (and can go down); imported sets never raise a max by themselves; more than 12 reps never sets one; a live record is never measured against an unclear point.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0372 Imported history counts",
  migrations: ["0372"],
  phases: {
    async "0372"({ db, h }) {
      const coach = await h.user("IC Coach");
      const stranger = await h.user("IC Other Coach");
      const client = await h.user("IC Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "IC team");
      await h.member(group, client);
      const org2 = await h.org(stranger);
      await h.group(org2, stranger, "team", "IC other");

      await h.asSuper();
      const session = async (day, historical, status = "completed") =>
        (await db.query(
          `insert into public.athlete_sessions (group_id, athlete_id, status, is_historical, started_at, completed_at) values ($1, $2, $3, $4, $5, $5) returning id`,
          [group, client, status, historical, `2026-08-${String(day).padStart(2, "0")}T12:00:17Z`]
        )).rows[0].id;
      const exercise = async (sid, name) =>
        (await db.query(`insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, $2, 0) returning id`, [sid, name])).rows[0].id;
      const sets = async (eid, rows, historical) => {
        const ids = [];
        for (let i = 0; i < rows.length; i++) {
          const [weight, reps] = rows[i];
          ids.push((await db.query(
            `insert into public.set_logs (session_exercise_id, set_order, weight, reps, status, completed_at, is_historical) values ($1, $2, $3, $4, 'completed', now(), $5) returning id`,
            [eid, i, weight, reps, historical]
          )).rows[0].id);
        }
        return ids;
      };
      const maxOf = async (name) => {
        const r = await db.query(`select estimated_max from public.athlete_training_maxes where athlete_id = $1 and exercise_name = $2`, [client, name]);
        return r.rows[0] ? Number(r.rows[0].estimated_max) : null;
      };

      // A live squat: 200 x 5 (RPE not logged, assumed 9) sets the max the way it always has: 200 x (1 + 6/30) = 240.
      await sets(await exercise(await session(1, false), "Squat"), [[200, 5]], false);
      h.check("a live set still sets a training max", (await maxOf("Squat")) === 240);

      // Imported squat history: 300 x 5. The trigger leaves imported sets alone; the rebuild folds them in.
      const imp = await sets(await exercise(await session(2, true), "Squat"), [[300, 5], [300, 5]], true);
      for (const day of [3, 4, 5]) await sets(await exercise(await session(day, true), "Squat"), [[200, 5], [205, 5], [200, 5]], true);
      h.check("an imported set does not raise a max by itself", (await maxOf("Squat")) === 240);

      await h.as(coach);
      const flagged = await tryQ(db, `select public.flag_unclear_sets($1, $2) as n`, [client, group]);
      h.check("nothing in the clean history is marked unclear", flagged.rows?.[0]?.n === 0);
      const rebuilt = await tryQ(db, `select public.recompute_training_maxes($1, null) as n`, [client]);
      h.check("the coach can rebuild a client's maxes" + (rebuilt.error ? ": " + rebuilt.error : ""), !rebuilt.error);
      await h.asSuper();
      h.check("the rebuild counts the imported set: 300 x 5 = 360", (await maxOf("Squat")) === 360);

      // An unclear point: a 10x weight, marked, never counts.
      const tenX = await sets(await exercise(await session(6, true), "Squat"), [[3000, 5]], true);
      await h.as(coach);
      await db.query(`select public.flag_unclear_sets($1, $2)`, [client, group]);
      await db.query(`select public.recompute_training_maxes($1, null)`, [client]);
      await h.asSuper();
      h.check("the 10x weight is marked unclear", (await db.query(`select data_flag from public.set_logs where id = $1`, [tenX[0]])).rows[0].data_flag === "unclear");
      h.check("...and does not raise the max", (await maxOf("Squat")) === 360);

      const roll = (await db.query(`select * from public.client_exercise_rollup($1, $2)`, [client, group])).rows;
      h.check("the rollup has one row per workout and exercise, imported ones marked", roll.length === 5 && roll.filter((r) => r.imported).length === 4);
      h.check("...it leaves out the unclear point (that workout has no counted set, so no row)", !roll.some((r) => Number(r.best_weight) === 3000));
      const first = roll.find((r) => Number(r.best_weight) === 300);
      h.check("...best weight, estimated max, volume and sets of an imported workout", first && Number(first.best_e1rm) === 360 && Number(first.volume) === 3000 && first.sets === 2 && first.imported === true && first.has_log === false);

      // Counting the unclear point folds it in; leaving it out again takes it back out.
      await h.as(coach);
      await db.query(`select public.set_unclear_point_counted($1, true)`, [tenX[0]]);
      await h.asSuper();
      h.check("counting an unclear point rebuilds the max (3000 x 5 = 3600)", (await maxOf("Squat")) === 3600);
      h.check("...and the rollup now has it", (await db.query(`select count(*)::int as n from public.client_exercise_rollup($1, $2) where best_weight = 3000`, [client, group])).rows[0].n === 1);
      await h.as(coach);
      await db.query(`select public.set_unclear_point_counted($1, false)`, [tenX[0]]);
      await h.asSuper();
      h.check("leaving it out again takes it back out (the max goes DOWN)", (await maxOf("Squat")) === 360);

      // Removing the import lowers the max to what is left.
      await h.as(coach);
      const sid = (await db.query(`select se.session_id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id where sl.id = $1`, [imp[0]])).rows[0].session_id;
      await db.query(`delete from public.athlete_sessions where id = $1 and is_historical`, [sid]);
      await db.query(`select public.recompute_training_maxes($1, null)`, [client]);
      await h.asSuper();
      h.check("removing the import lowers the max to what is left (205 x 5 = 246)", (await maxOf("Squat")) === 246);

      // More than 12 reps never sets a max; a rebuild does not either.
      await sets(await exercise(await session(7, false), "Curl"), [[100, 20]], false);
      h.check("a live set of more than 12 reps does not set a max", (await maxOf("Curl")) === null);
      await h.as(coach);
      await db.query(`select public.recompute_training_maxes($1, null)`, [client]);
      await h.asSuper();
      h.check("...and a rebuild does not either", (await maxOf("Curl")) === null);

      // Who may rebuild.
      await h.as(stranger);
      h.check("a coach of another group cannot rebuild this client's maxes", !!(await tryQ(db, `select public.recompute_training_maxes($1, null)`, [client])).error);
      await h.as(client);
      h.check("the client can rebuild their own", !(await tryQ(db, `select public.recompute_training_maxes($1, null)`, [client])).error);
      h.check("the client can read their own rollup", ((await tryQ(db, `select * from public.client_exercise_rollup($1, $2)`, [client, group])).rows ?? []).length > 0);
      await h.as(stranger);
      h.check("a coach of another group sees an empty rollup (row security applies)", ((await tryQ(db, `select * from public.client_exercise_rollup($1, $2)`, [client, group])).rows ?? []).length === 0);

      // The live personal-record check ignores unclear points.
      await h.asSuper();
      h.check("the completion function measures a record only against counted sets", (await db.query(`select position('sl.data_flag' in pg_get_functiondef(to_regprocedure('public.complete_workout_session(uuid)'))) > 0 as ok`)).rows[0].ok === true);
      h.check("the training-max trigger ignores imported sets and over-12-rep sets", (await db.query(`select pg_get_functiondef(to_regprocedure('public.recompute_training_max()')) like '%new.reps > 12%' as ok`)).rows[0].ok === true);
    },
  },
};
