// 0385: the kind of each set. A warm-up or drop set never makes a record, never raises a training max, never counts; a record is per number of reps; a longer hold is a record; a training max comes only from a set
// of 1 to 8 reps; marking a saved set a warm-up rebuilds that exercise's max.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0385 Set types and records",
  migrations: ["0385"],
  phases: {
    async "0385"({ db, h }) {
      const coach = await h.user("ST Coach");
      const client = await h.user("ST Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "ST team");
      await h.member(group, client);

      await h.asSuper();
      const session = async (day, status) =>
        (await db.query(
          `insert into public.athlete_sessions (group_id, athlete_id, status, started_at, completed_at) values ($1, $2, $3, $4, $5) returning id`,
          [group, client, status, `2026-09-${String(day).padStart(2, "0")}T12:00:00Z`, status === "completed" ? `2026-09-${String(day).padStart(2, "0")}T13:00:00Z` : null]
        )).rows[0].id;
      const exercise = async (sid, name) =>
        (await db.query(`insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, $2, 0) returning id`, [sid, name])).rows[0].id;
      const set = async (eid, order, cols) => {
        const c = { weight: null, reps: null, time_seconds: null, distance: null, set_type: "working", ...cols };
        return (await db.query(
          `insert into public.set_logs (session_exercise_id, set_order, weight, reps, time_seconds, distance, set_type, status, completed_at) values ($1, $2, $3, $4, $5, $6, $7, 'completed', now()) returning id`,
          [eid, order, c.weight, c.reps, c.time_seconds, c.distance, c.set_type]
        )).rows[0].id;
      };
      const finish = async (sid) => {
        await h.as(client);
        const r = (await h.rows(`select * from public.complete_workout_session($1)`, [sid]))[0];
        await h.asSuper();
        return r.new_prs ?? [];
      };
      const maxOf = async (name) => {
        const r = await db.query(`select estimated_max from public.athlete_training_maxes where athlete_id = $1 and exercise_name = $2`, [client, name]);
        return r.rows[0] ? Number(r.rows[0].estimated_max) : null;
      };

      // ---- the column
      const bad = await tryQ(db, `update public.set_logs set set_type = 'banana' where false`);
      h.check("the set-type column exists", !bad.error);
      const e0 = await exercise(await session(1, "completed"), "Squat");
      const s0 = await set(e0, 0, { weight: 200, reps: 5 });
      h.check("a set is a working set unless said otherwise", (await h.one(`select set_type from public.set_logs where id = $1`, [s0])).set_type === "working");
      await h.expectError("a made-up set type is refused", () => db.query(`update public.set_logs set set_type = 'banana' where id = $1`, [s0]), /set_logs_set_type_check/);

      // ---- records: history is Squat 200 x 5, Deadlift 300 x 1, Plank 30 s, Run 1000 m in 600 s
      await set(await exercise(await session(2, "completed"), "Deadlift"), 0, { weight: 300, reps: 1 });
      await set(await exercise(await session(3, "completed"), "Plank"), 0, { time_seconds: 30 });
      await set(await exercise(await session(4, "completed"), "Run"), 0, { time_seconds: 600, distance: 1000 });

      // a warm-up heavier than the record does not make one; neither does a drop set
      let sid = await session(10, "in_progress");
      let e = await exercise(sid, "Squat");
      await set(e, 0, { weight: 250, reps: 5, set_type: "warmup" });
      await set(e, 1, { weight: 250, reps: 5, set_type: "drop" });
      h.check("a warm-up or drop set is never a record", !(await finish(sid)).includes("Squat"));

      // a working set that beats it is
      sid = await session(11, "in_progress");
      e = await exercise(sid, "Squat");
      await set(e, 0, { weight: 205, reps: 5 });
      h.check("a heavier working set is a record", (await finish(sid)).includes("Squat"));

      // per number of reps: 250 x 5 beats 205 x 5 even though 250 is lighter than the 300 single
      sid = await session(12, "in_progress");
      e = await exercise(sid, "Deadlift");
      await set(e, 0, { weight: 250, reps: 5 });
      h.check("5 reps at 250 is a record for 5 reps although the heaviest single was 300", (await finish(sid)).includes("Deadlift"));

      // equal is not a record; lighter for the same reps is not a record
      sid = await session(13, "in_progress");
      e = await exercise(sid, "Deadlift");
      await set(e, 0, { weight: 250, reps: 5 });
      await set(e, 1, { weight: 245, reps: 5 });
      h.check("the same weight and reps again is not a record", !(await finish(sid)).includes("Deadlift"));

      // a hold: longer is better
      sid = await session(14, "in_progress");
      e = await exercise(sid, "Plank");
      await set(e, 0, { time_seconds: 20 });
      h.check("a shorter hold is not a record", !(await finish(sid)).includes("Plank"));
      sid = await session(15, "in_progress");
      e = await exercise(sid, "Plank");
      await set(e, 0, { time_seconds: 45 });
      h.check("a longer hold is a record", (await finish(sid)).includes("Plank"));

      // a timed distance: faster is better
      sid = await session(16, "in_progress");
      e = await exercise(sid, "Run");
      await set(e, 0, { time_seconds: 580, distance: 1000 });
      h.check("a faster timed distance is a record", (await finish(sid)).includes("Run"));

      // ---- training maxes
      await set(await exercise(await session(20, "completed"), "Bench"), 0, { weight: 100, reps: 10 });
      h.check("a set of 10 reps sets no training max", (await maxOf("Bench")) === null);
      await set(await exercise(await session(21, "completed"), "Bench"), 0, { weight: 100, reps: 8 });
      h.check("a set of 8 reps does: 100 x (1 + 9/30) = 130", (await maxOf("Bench")) === 130);
      await set(await exercise(await session(22, "completed"), "Press"), 0, { weight: 300, reps: 3, set_type: "warmup" });
      h.check("a warm-up sets no training max", (await maxOf("Press")) === null);

      // marking a saved set a warm-up takes its max away; marking it working again brings it back
      const sidLive = await session(23, "in_progress");
      const eLive = await exercise(sidLive, "Row");
      const rowSet = await set(eLive, 0, { weight: 150, reps: 3 });
      h.check("a working set of 3 sets a max: 150 x (1 + 4/30) = 170", (await maxOf("Row")) === 170);
      await h.as(client);
      const flip = await tryQ(db, `update public.set_logs set set_type = 'warmup' where id = $1`, [rowSet]);
      await h.asSuper();
      h.check("the client can mark their own set a warm-up" + (flip.error ? ": " + flip.error : ""), !flip.error);
      h.check("...and the max that set made is gone", (await maxOf("Row")) === null);
      await h.as(client);
      await db.query(`update public.set_logs set set_type = 'working' where id = $1`, [rowSet]);
      await h.asSuper();
      h.check("...and back to a working set it counts again", (await maxOf("Row")) === 170);

      // ---- permissions did not change
      const acl = await h.one(`select has_function_privilege('authenticated', 'public.recompute_on_set_type_change()', 'execute') as a, has_function_privilege('anon', 'public.recompute_on_set_type_change()', 'execute') as b, has_function_privilege('anon', 'public.complete_workout_session(uuid)', 'execute') as c`);
      h.check("the trigger function is not callable by signed-in users or visitors, and completing a workout still not by visitors", acl.a === false && acl.b === false && acl.c === false, JSON.stringify(acl));
    },
  },
};
