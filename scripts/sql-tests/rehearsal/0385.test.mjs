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
          [group, client, status, new Date(Date.UTC(2026, 8, day, 12)).toISOString(), status === "completed" ? new Date(Date.UTC(2026, 8, day, 13)).toISOString() : null]
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

      // ---- stored maxes are never wiped or lowered by the new 1-to-8-rep window (the shape of the live data: maxes resting only on sets of 9 or more reps)
      const putMax = (name, est, w, r) =>
        db.query(
          `insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe, source_rpe_assumed, updated_at) values ($1, $2, $3, $4, $5, 9, true, now())
           on conflict (athlete_id, exercise_name) do update set estimated_max = excluded.estimated_max, source_weight = excluded.source_weight, source_reps = excluded.source_reps`,
          [client, name, est, w, r]
        );
      const sOld = await session(30, "completed");
      // A: rests only on a 10-rep set (150 x 10 -> 205)
      await set(await exercise(sOld, "Legacy A"), 0, { weight: 150, reps: 10 });
      await putMax("Legacy A", 205, 150, 10);
      // B: a 10-rep set (205) and a lower 5-rep set (180): the 5-rep estimate must not shrink it
      const eB = await exercise(await session(31, "completed"), "Legacy B");
      await set(eB, 0, { weight: 150, reps: 10 });
      await set(eB, 1, { weight: 150, reps: 5 });
      await putMax("Legacy B", 205, 150, 10);
      // C: a 400 stored from a typo set that is now marked unclear: it still can come down
      const eC = await exercise(await session(32, "completed"), "Legacy C");
      const typo = await set(eC, 0, { weight: 300, reps: 10 });
      await set(eC, 1, { weight: 100, reps: 5 });
      await putMax("Legacy C", 410, 300, 10);
      await db.query(`update public.set_logs set data_flag = 'unclear' where id = $1`, [typo]);
      // D: a max resting only on a 15-rep set (the earlier rules had no rep limit) is kept too
      await set(await exercise(await session(33, "completed"), "Legacy D"), 0, { weight: 100, reps: 15 });
      await putMax("Legacy D", 150, 100, 15);
      // D2: nothing counted is left behind the row (its only set is a warm-up): it is dropped
      await set(await exercise(await session(36, "completed"), "Legacy D2"), 0, { weight: 100, reps: 15, set_type: "warmup" });
      await putMax("Legacy D2", 150, 100, 15);
      // G: a 15-rep max plus a lower 5-rep set: the 5-rep estimate must not shrink it
      const eG = await exercise(await session(37, "completed"), "Legacy G");
      await set(eG, 0, { weight: 135, reps: 15 });
      await set(eG, 1, { weight: 135, reps: 5 });
      await putMax("Legacy G", 200, 135, 15);
      // E: a 12-rep set and a heavier 3-rep set: the new estimate (higher) replaces the stored one
      const eE = await exercise(await session(34, "completed"), "Legacy E");
      await set(eE, 0, { weight: 100, reps: 12 });
      await set(eE, 1, { weight: 200, reps: 3 });
      await putMax("Legacy E", 100, 100, 12);
      await h.as(client);
      const rebuilt = await tryQ(db, `select public.recompute_training_maxes($1, null) as n`, [client]);
      await h.asSuper();
      h.check("a recompute runs for the client" + (rebuilt.error ? ": " + rebuilt.error : ""), !rebuilt.error);
      h.check("a max that rests only on a 10-rep set is kept, not wiped", (await maxOf("Legacy A")) === 205);
      h.check("a lower 5-rep estimate does not shrink a stored max (205 stays, not 180)", (await maxOf("Legacy B")) === 205);
      h.check("a max from a set marked unclear can still come down (to the 100 x 5 = 120)", (await maxOf("Legacy C")) === 120);
      h.check("a max that rests only on a 15-rep set is kept, not wiped", (await maxOf("Legacy D")) === 150);
      h.check("a max with no counted set at all behind it is dropped", (await maxOf("Legacy D2")) === null);
      h.check("a lower 5-rep estimate does not shrink a max that rests on a 15-rep set (200 stays)", (await maxOf("Legacy G")) === 200);
      h.check("a higher 1-to-8-rep estimate replaces a stored max (200 x 3 = 226.7)", (await maxOf("Legacy E")) === 226.7);
      h.check("the earlier maxes in this test are unchanged by the recompute", (await maxOf("Bench")) === 130 && (await maxOf("Row")) === 170);
      const nineUp = await set(await exercise(await session(35, "completed"), "Legacy F"), 0, { weight: 100, reps: 9 });
      h.check("a NEW set of 9 reps makes no max going forward", nineUp && (await maxOf("Legacy F")) === null);

      // ---- a hold and a timed distance for the same exercise in one session both complete (each has its own record field)
      sid = await session(40, "in_progress");
      e = await exercise(sid, "Row");
      await set(e, 0, { time_seconds: 600, distance: 2000 });
      await set(e, 1, { time_seconds: 300 });
      await h.as(client);
      const both = await tryQ(db, `select * from public.complete_workout_session($1)`, [sid]);
      await h.asSuper();
      h.check("a session with a timed distance and a time-only hold for one exercise completes" + (both.error ? ": " + both.error : ""), !both.error);
      const fields = (await db.query(`select tracked_field from public.exercise_records where group_id = $1 and exercise_name = 'Row' and superseded_at is null order by tracked_field`, [group])).rows.map((r) => r.tracked_field);
      h.check("...and the hold and the timed-distance records live side by side (hold_seconds and time_seconds)", fields.includes("hold_seconds") && fields.includes("time_seconds"), JSON.stringify(fields));

      // ---- the old shortest-hold records are replaced by the real longest hold (the end of the migration, run here on a hand-made old row)
      const eW1 = await exercise(await session(41, "completed"), "Wall sit");
      await set(eW1, 0, { time_seconds: 40 });
      await set(await exercise(await session(42, "completed"), "Wall sit"), 0, { time_seconds: 70 });
      await set(await exercise(await session(43, "completed"), "Wall sit"), 0, { time_seconds: 200, set_type: "warmup" });
      await db.query(`insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, achieved_at) values ($1, 'Wall sit', 'time_seconds', 'lower_better', 40, $2, now())`, [group, client]);
      const migrationText = (await import("node:fs")).readFileSync(new URL("../../../supabase/migrations/0385_set_types_and_records.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
      const tail = migrationText.slice(migrationText.indexOf("-- Hold records."));
      h.check("the end of the migration is found", tail.length > 100);
      await db.exec(tail);
      const old = await h.one(`select count(*)::int as n from public.exercise_records where group_id = $1 and exercise_name = 'Wall sit' and tracked_field = 'time_seconds' and superseded_at is null`, [group]);
      h.check("the old shortest-hold row is no longer live", old.n === 0);
      const hold = await h.one(`select value from public.exercise_records where group_id = $1 and exercise_name = 'Wall sit' and tracked_field = 'hold_seconds' and superseded_at is null`, [group]);
      h.check("the real longest counted hold (70, not the warm-up's 200) is the record now", Number(hold.value) === 70, JSON.stringify(hold));
      const runRow = await h.one(`select count(*)::int as n from public.exercise_records where group_id = $1 and exercise_name = 'Run' and tracked_field = 'time_seconds' and superseded_at is null`, [group]);
      h.check("a timed-distance record is left as it was", runRow.n === 1);
      sid = await session(44, "in_progress");
      e = await exercise(sid, "Wall sit");
      await set(e, 0, { time_seconds: 60 });
      h.check("a hold shorter than the real longest is not announced as a record", !(await finish(sid)).includes("Wall sit"));

      // ---- the set-type trigger does not run the caller check again
      const trig = await h.one(`select prosrc from pg_proc where proname = 'recompute_on_set_type_change'`);
      h.check("the set-type trigger calls the rebuild that has no caller check", trig.prosrc.includes("recompute_training_maxes_internal") && !/recompute_training_maxes\(/.test(trig.prosrc));
      const aclInternal = await h.one(`select has_function_privilege('authenticated', 'public.recompute_training_maxes_internal(uuid, text)', 'execute') as a, has_function_privilege('anon', 'public.recompute_training_maxes_internal(uuid, text)', 'execute') as b`);
      h.check("the internal rebuild is not callable by signed-in users or visitors", aclInternal.a === false && aclInternal.b === false, JSON.stringify(aclInternal));

      // ---- permissions did not change
      const acl = await h.one(`select has_function_privilege('authenticated', 'public.recompute_on_set_type_change()', 'execute') as a, has_function_privilege('anon', 'public.recompute_on_set_type_change()', 'execute') as b, has_function_privilege('anon', 'public.complete_workout_session(uuid)', 'execute') as c`);
      h.check("the trigger function is not callable by signed-in users or visitors, and completing a workout still not by visitors", acl.a === false && acl.b === false && acl.c === false, JSON.stringify(acl));
    },
  },
};
