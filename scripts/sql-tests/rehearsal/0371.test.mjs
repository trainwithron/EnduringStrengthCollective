// 0371: unclear data points in imported history. The rules mark only the single suspicious imported set (never the exercise), keep its numbers exactly as entered, never touch live sets,
// never undo a coach's decision, and only a coach of the client's group can change a mark.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0371 Unclear data points",
  migrations: ["0371"],
  phases: {
    async "0371"({ db, h }) {
      const coach = await h.user("UD Coach");
      const stranger = await h.user("UD Other Coach");
      const client = await h.user("UD Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "UD team");
      await h.member(group, client);
      const org2 = await h.org(stranger);
      const group2 = await h.group(org2, stranger, "team", "UD other");

      await h.asSuper();
      const session = async (day, historical) =>
        (await db.query(
          `insert into public.athlete_sessions (group_id, athlete_id, status, is_historical, started_at, completed_at) values ($1, $2, 'completed', $3, $4, $4) returning id`,
          [group, client, historical, `2026-08-${String(day).padStart(2, "0")}T12:00:17Z`]
        )).rows[0].id;
      const exercise = async (sid, name) =>
        (await db.query(`insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, $2, 0) returning id`, [sid, name])).rows[0].id;
      const sets = async (eid, rows, historical = true) => {
        const ids = [];
        for (let i = 0; i < rows.length; i++) {
          const [weight, reps, extra] = rows[i];
          ids.push((await db.query(
            `insert into public.set_logs (session_exercise_id, set_order, weight, reps, time_seconds, status, completed_at, is_historical) values ($1, $2, $3, $4, $5, 'completed', now(), $6) returning id`,
            [eid, i, weight, reps, extra?.time ?? null, historical]
          )).rows[0].id);
        }
        return ids;
      };
      const flagOf = async (id) => (await db.query(`select data_flag, data_flag_reason from public.set_logs where id = $1`, [id])).rows[0];

      // Four earlier sessions of a squat around 200 lb, so the client has a usual weight.
      for (const day of [1, 2, 3, 4]) {
        await sets(await exercise(await session(day, true), "Squat"), [[200, 5], [205, 5], [200, 5]]);
      }
      const jumbled = await sets(await exercise(await session(5, true), "Squat"), [[200, 5], [200, 5], [2, 5]]);
      const tenX = await sets(await exercise(await session(6, true), "Squat"), [[2000, 5]]);
      for (const day of [11, 12, 13]) await sets(await exercise(await session(day, true), "Bench"), [[135, 5], [135, 5]]);
      const noReps = await sets(await exercise(await session(7, true), "Bench"), [[135, null]]);
      const weightOnlyCarry = await sets(await exercise(await session(14, true), "Suitcase Carry"), [[70, null], [70, null], [70, null]]);
      const manyReps = await sets(await exercise(await session(8, true), "Row"), [[50, 150]]);
      const carry = await sets(await exercise(await session(9, true), "Farmer carry"), [[100, null, { time: 30 }]]);
      const bodyweight = await sets(await exercise(await session(9, true), "Pull-up"), [[0, 8]]);
      const live = await sets(await exercise(await session(10, false), "Squat"), [[200, 5], [200, 5], [2, 5]], false);

      await h.as(coach);
      const flagged = await tryQ(db, `select public.flag_unclear_sets($1, $2) as n`, [client, group]);
      h.check("the coach can run the check for their client" + (flagged.error ? ": " + flagged.error : ""), !flagged.error);
      h.check("it marked exactly the four suspicious sets", flagged.rows?.[0]?.n === 4);

      await h.asSuper();
      h.check("the last set far below the others (200, 200, 2) is marked, and only that set", (await flagOf(jumbled[2])).data_flag === "unclear" && (await flagOf(jumbled[0])).data_flag === null && (await flagOf(jumbled[1])).data_flag === null);
      h.check("...with a plain reason", (await flagOf(jumbled[2])).data_flag_reason === "Last set far below the others");
      h.check("a weight ten times the usual is marked", (await flagOf(tenX[0])).data_flag_reason === "Weight far above the usual for this exercise");
      h.check("a weight with no reps is marked", (await flagOf(noReps[0])).data_flag_reason === "Weight but no reps");
      h.check("reps over 100 is marked", (await flagOf(manyReps[0])).data_flag_reason === "Reps over 100");
      h.check("an exercise that is always logged weight-only (a carry) is NOT marked", (await flagOf(weightOnlyCarry[0])).data_flag === null && (await flagOf(weightOnlyCarry[2])).data_flag === null);
      h.check("a timed carry with a weight and no reps is NOT marked", (await flagOf(carry[0])).data_flag === null);
      h.check("an unloaded bodyweight move (weight 0) is NOT marked", (await flagOf(bodyweight[0])).data_flag === null);
      h.check("a live set that looks the same is never marked", (await flagOf(live[2])).data_flag === null);
      h.check("the marked set keeps its numbers exactly as entered", (await db.query(`select weight, reps from public.set_logs where id = $1`, [jumbled[2]])).rows[0].weight === "2" || Number((await db.query(`select weight from public.set_logs where id = $1`, [jumbled[2]])).rows[0].weight) === 2);

      await h.as(coach);
      const again = await tryQ(db, `select public.flag_unclear_sets($1, $2) as n`, [client, group]);
      h.check("running it again marks nothing new", again.rows?.[0]?.n === 0);

      const counted = await tryQ(db, `select public.set_unclear_point_counted($1, true)`, [jumbled[2]]);
      h.check("the coach can count a marked point" + (counted.error ? ": " + counted.error : ""), !counted.error);
      await h.asSuper();
      h.check("...it becomes accepted", (await flagOf(jumbled[2])).data_flag === "accepted");
      await h.as(coach);
      await db.query(`select public.flag_unclear_sets($1, $2)`, [client, group]);
      await h.asSuper();
      h.check("running the check again never undoes the coach's decision", (await flagOf(jumbled[2])).data_flag === "accepted");
      await h.as(coach);
      await db.query(`select public.set_unclear_point_counted($1, false)`, [jumbled[2]]);
      await h.asSuper();
      h.check("the coach can leave it out of the numbers again", (await flagOf(jumbled[2])).data_flag === "unclear");

      await h.as(client);
      const selfRun = await tryQ(db, `select public.flag_unclear_sets($1, $2) as n`, [client, group]);
      h.check("a client can run the check for their own history (it only adds marks)" + (selfRun.error ? ": " + selfRun.error : ""), !selfRun.error);
      const selfCount = await tryQ(db, `select public.set_unclear_point_counted($1, true)`, [jumbled[2]]);
      h.check("...but cannot count a point", !!selfCount.error);
      await h.asSuper();
      h.check("...and it left the coach's mark as it was", (await flagOf(jumbled[2])).data_flag === "unclear");

      await h.as(stranger);
      const refusedRun = await tryQ(db, `select public.flag_unclear_sets($1, $2)`, [client, group]);
      h.check("a coach of another group cannot run the check for this client", !!refusedRun.error);
      const refusedCount = await tryQ(db, `select public.set_unclear_point_counted($1, true)`, [jumbled[2]]);
      h.check("...or count a point", !!refusedCount.error);

      await h.as(client);
      await db.query(`update public.set_logs set data_flag = null, data_flag_reason = null where id = $1`, [jumbled[2]]);
      await h.asSuper();
      h.check("a client cannot clear a mark on their own history", (await flagOf(jumbled[2])).data_flag === "unclear");
      await h.asSuper();
      const liveExercise = (await db.query(`select id from public.session_exercises where session_id = (select id from public.athlete_sessions where group_id = $1 and is_historical = false limit 1) limit 1`, [group])).rows[0].id;
      await h.as(client);
      const forged = await tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, status, data_flag) values ($1, 9, 50, 5, 'completed', 'unclear') returning id`, [liveExercise]);
      await h.asSuper();
      h.check("a client cannot write a mark on a set they add", !forged.rows || (await flagOf(forged.rows[0].id)).data_flag === null);

      // the other group is untouched by all of this
      await h.asSuper();
      h.check("a group with no history has nothing marked", (await db.query(`select count(*)::int as n from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.group_id = $1 and sl.data_flag is not null`, [group2])).rows[0].n === 0);
    },
  },
};
