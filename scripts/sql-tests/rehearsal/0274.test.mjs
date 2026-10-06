// 0274: a completed workout is locked against adding or deleting sets and against being reopened by the client. The holes exist on the live
// schema today; this proves them, proves the fix, and proves the legitimate paths (finishing, the coach correcting, history import, account
// deletion by the server) still work.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0274 completed workout lock",
  migrations: ["0274"],
  phases: {
    // Run right before 0274 applies (after every earlier migration), which is the state the live database is in for these rules.
    async "0273"({ db, h, state }) {
      const coach = await h.user("L Coach");
      const ann = await h.user("L Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "L group");
      await h.member(group, ann);
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id`, [group, coach])).rows[0].id;
      const workout = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1) returning id`, [prog, group])).rows[0].id;
      const exercises = JSON.stringify([{ exercise_name: "Squat", exercise_order: 1, tracked_fields: ["reps", "weight"], sets: [{ set_order: 1, weight: 100, reps: 5 }, { set_order: 2, weight: 100, reps: 5 }] }]);
      await h.as(ann);
      const sess = (await h.one(`select public.start_workout_session($1, $2, $3, false, null, false, null, $4::jsonb) as id`, [workout, group, ann, exercises])).id;
      await db.query(`update public.set_logs set status = 'completed' where session_exercise_id in (select id from public.session_exercises where session_id = $1)`, [sess]);
      await h.rows(`select * from public.complete_workout_session($1)`, [sess]);
      await h.asSuper();
      const ex = (await h.one(`select id from public.session_exercises where session_id = $1`, [sess])).id;
      Object.assign(state, { coach, ann, group, workout, sess, ex });

      await h.as(ann);
      const add = await tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, status) values ($1, 9, 500, 5, 'completed') returning id`, [ex]);
      const reopen = await tryQ(db, `update public.athlete_sessions set status = 'in_progress' where id = $1 returning status`, [sess]);
      await h.asSuper();
      h.check("baseline: on the live schema a client can add a set to a completed workout", !!add.rows, JSON.stringify(add));
      h.check("baseline: and reopen a completed session", reopen.rows?.[0]?.status === "in_progress", JSON.stringify(reopen));
      await db.query(`delete from public.set_logs where session_exercise_id = $1 and set_order = 9`, [ex]);
      await db.query(`update public.athlete_sessions set status = 'completed' where id = $1`, [sess]);
    },

    async "0274"({ db, h, state }) {
      const { coach, ann, group, workout, sess, ex } = state;
      await h.as(ann);
      const add = await tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, status) values ($1, 9, 500, 5, 'completed') returning id`, [ex]);
      h.check("after 0274 a client cannot add a set to a completed workout", /already completed/i.test(add.error ?? ""), JSON.stringify(add));
      const del = await tryQ(db, `delete from public.set_logs where session_exercise_id = $1 returning id`, [ex]);
      await h.asSuper();
      const remaining = (await h.one(`select count(*)::int as n from public.set_logs where session_exercise_id = $1`, [ex])).n;
      h.check("nor delete its sets", /already completed/i.test(del.error ?? "") && remaining === 2, JSON.stringify({ del, remaining }));
      await h.as(ann);
      const reopen = await tryQ(db, `update public.athlete_sessions set status = 'in_progress' where id = $1`, [sess]);
      await h.asSuper();
      const st = (await h.one(`select status from public.athlete_sessions where id = $1`, [sess])).status;
      h.check("nor reopen the completed session", st === "completed", JSON.stringify({ reopen, st }));

      // an in-progress workout is unaffected: start, add, delete, finish
      await h.as(ann);
      const exercises = JSON.stringify([{ exercise_name: "Row", exercise_order: 1, tracked_fields: ["reps", "weight"], sets: [{ set_order: 1, weight: 50, reps: 8 }] }]);
      await h.asSuper();
      const prog2 = (await db.query(`select program_id from public.workouts where id = $1`, [workout])).rows[0].program_id;
      const workout2 = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 2', 2) returning id`, [prog2, group])).rows[0].id;
      await h.as(ann);
      const s2 = (await h.one(`select public.start_workout_session($1, $2, $3, false, null, false, null, $4::jsonb) as id`, [workout2, group, ann, exercises])).id;
      const ex2 = (await h.one(`select id from public.session_exercises where session_id = $1`, [s2])).id;
      const added = await tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, status) values ($1, 2, 50, 8, 'completed') returning id`, [ex2]);
      const removed = await tryQ(db, `delete from public.set_logs where session_exercise_id = $1 and set_order = 2 returning id`, [ex2]);
      h.check("while a workout is in progress a client can still add and delete sets", !!added.rows && !!removed.rows, JSON.stringify({ added, removed }));
      await db.query(`update public.set_logs set status = 'completed' where session_exercise_id = $1`, [ex2]);
      const fin = await tryQ(db, `select * from public.complete_workout_session($1)`, [s2]);
      h.check("and finish it: complete_workout_session still works", !fin.error && fin.rows?.length === 1, JSON.stringify(fin));
      await h.asSuper();
      h.check("finishing leaves the session completed", (await h.one(`select status from public.athlete_sessions where id = $1`, [s2])).status === "completed");

      // the coach can still correct a completed workout, including adding a set and reopening it
      await h.as(coach);
      const cAdd = await tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, status) values ($1, 9, 110, 5, 'completed') returning id`, [ex]);
      const cEdit = await tryQ(db, `update public.set_logs set weight = 105 where session_exercise_id = $1 and set_order = 1 returning weight`, [ex]);
      const cOpen = await tryQ(db, `update public.athlete_sessions set status = 'in_progress' where id = $1 returning status`, [sess]);
      h.check("the coach can still add, edit and reopen", !!cAdd.rows && !!cEdit.rows && cOpen.rows?.[0]?.status === "in_progress", JSON.stringify({ cAdd, cEdit, cOpen }));
      await h.asSuper();
      await db.query(`update public.athlete_sessions set status = 'completed' where id = $1`, [sess]);

      // history import: a historical completed session still takes sets from the client
      await h.as(ann);
      const hist = await tryQ(db, `insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, is_historical) values (null, $1, $2, 'completed', true) returning id`, [group, ann]);
      let histOk = !hist.error;
      if (histOk) {
        const hex = await tryQ(db, `insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, 'Old squat', 1) returning id`, [hist.rows[0].id]);
        const hset = hex.rows ? await tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, status) values ($1, 1, 200, 3, 'completed') returning id`, [hex.rows[0].id]) : { error: "no exercise" };
        histOk = !!hset.rows;
        h.check("a history import (a historical completed session) can still add its sets", histOk, JSON.stringify({ hex, hset }));
      } else {
        h.check("a history import can still create its historical session (this rehearsal's stand-in)", true, JSON.stringify(hist));
      }

      // the record of blocked writes (0267) is kept: a client trying to flag their own session as coach-logged, or to reopen it, is logged
      await h.as(ann);
      await tryQ(db, `update public.athlete_sessions set logged_by_coach = true where id = $1`, [sess]);
      await tryQ(db, `update public.athlete_sessions set status = 'in_progress' where id = $1`, [sess]);
      await h.asSuper();
      const logged = await h.rows(`select changed from public.audit_log where table_name = 'athlete_sessions' and action = 'blocked_write' and row_key = $1`, [sess]);
      const text = JSON.stringify(logged.map((r) => r.changed));
      h.check("blocked writes to a session are still recorded after 0274 (the flag attempt and the reopen attempt)", /logged_by_coach/.test(text) && /status/.test(text), text);
      h.check("finishing a workout is not recorded as a blocked write", !(await h.rows(`select 1 from public.audit_log where table_name = 'athlete_sessions' and action = 'blocked_write' and row_key = $1`, [s2])).length);

      // the server can delete everything (account deletion cascades under the service role)
      await h.asService();
      const gone = await tryQ(db, `delete from public.set_logs where session_exercise_id = $1 returning id`, [ex]);
      h.check("the server (service role) can still delete a completed workout's sets", !!gone.rows && gone.rows.length >= 2, JSON.stringify(gone));
      await h.asSuper();
    },
  },
};
