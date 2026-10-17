// 0389: the app at 1,500 clients. Three count functions that run as the caller (so row security applies), indexes, a rule that set values must be real (rows already flagged unclear are exempt), a test mark on
// organizations, and the stale-workout closer.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0389 Scale and data quality",
  migrations: ["0389"],
  phases: {
    async "0389"({ db, h }) {
      const coach = await h.user("SC Coach");
      const other = await h.user("SC Other Coach");
      const a1 = await h.user("SC Client One");
      const a2 = await h.user("SC Client Two");
      const org = await h.org(coach);
      const g1 = await h.group(org, coach, "team", "SC team one");
      const g2 = await h.group(org, coach, "team", "SC team two");
      await h.member(g1, a1);
      await h.member(g2, a2);
      const otherOrg = await h.org(other);
      const g3 = await h.group(otherOrg, other, "team", "SC elsewhere");
      await h.member(g3, a1);

      await h.asSuper();
      const log = async (athlete, group, at) => {
        const sid = (await db.query(`insert into public.athlete_sessions (group_id, athlete_id, status, started_at, completed_at) values ($1, $2, 'completed', $3, $3) returning id`, [group, athlete, at])).rows[0].id;
        return (await db.query(`insert into public.workout_logs (session_id, athlete_id, group_id, created_at) values ($1, $2, $3, $4) returning id`, [sid, athlete, group, at])).rows[0].id;
      };
      await log(a1, g1, "2026-10-01T10:00:00Z");
      await log(a1, g1, "2026-10-05T10:00:00Z");
      await log(a2, g2, "2026-10-03T10:00:00Z");
      await log(a1, g3, "2026-10-09T10:00:00Z"); // another organization's group

      // ---- last workout per client, as the coach (row security applies)
      await h.as(coach);
      const last = await tryQ(db, `select athlete_id, last_at from public.business_last_active($1::uuid[]) order by athlete_id`, [[g1, g2]]);
      h.check("business_last_active runs for a coach" + (last.error ? ": " + last.error : ""), !last.error);
      const byAthlete = Object.fromEntries((last.rows ?? []).map((r) => [r.athlete_id, new Date(r.last_at).toISOString()]));
      h.check("one row per client with the latest workout in those groups", Object.keys(byAthlete).length === 2 && byAthlete[a1] === "2026-10-05T10:00:00.000Z" && byAthlete[a2] === "2026-10-03T10:00:00.000Z", JSON.stringify(byAthlete));
      h.check("a workout in another organization's group is not counted for these groups", byAthlete[a1] !== "2026-10-09T10:00:00.000Z");
      await h.as(a1);
      const mine = await tryQ(db, `select count(*)::int as n from public.business_last_active($1::uuid[])`, [[g1, g2]]);
      h.check("a client asking sees only what row security lets them see (their own row at most)", !mine.error && mine.rows[0].n <= 1, JSON.stringify(mine));
      await h.as(null);
      const anon = await tryQ(db, `select * from public.business_last_active($1::uuid[])`, [[g1]]);
      h.check("a signed-out visitor cannot call it", !!anon.error);

      // ---- unseen groups
      await h.asSuper();
      await db.query(`insert into public.coach_view_state (coach_id, group_id, feed_seen_at, clients_seen_at) values ($1, $2, '2026-10-02T00:00:00Z', '2026-10-06T00:00:00Z'), ($1, $3, '2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z')
        on conflict (coach_id, group_id) do update set feed_seen_at = excluded.feed_seen_at, clients_seen_at = excluded.clients_seen_at`, [coach, g1, g2]);
      await h.as(coach);
      const unseen = await tryQ(db, `select group_id, unseen from public.coach_unseen_groups($1::uuid[]) order by group_id`, [[g1, g2]]);
      h.check("coach_unseen_groups runs" + (unseen.error ? ": " + unseen.error : ""), !unseen.error);
      const u = Object.fromEntries((unseen.rows ?? []).map((r) => [r.group_id, r.unseen]));
      h.check("a group with a workout newer than the coach last looked is unseen; one with nothing newer is not", u[g1] === false && u[g2] === false, JSON.stringify(u));
      await h.asSuper();
      await log(a2, g2, "2026-10-08T10:00:00Z");
      await h.as(coach);
      const unseen2 = await tryQ(db, `select group_id, unseen from public.coach_unseen_groups($1::uuid[])`, [[g2]]);
      h.check("a new workout makes the group unseen", unseen2.rows?.[0]?.unseen === true, JSON.stringify(unseen2));

      // ---- digest counts are server only
      await h.asSuper();
      const digest = await tryQ(db, `select new_posts::int as p, active_athletes::int as a from public.coach_digest_activity($1, $2::uuid[])`, [coach, [g1, g2]]);
      h.check("the digest counts run for the server" + (digest.error ? ": " + digest.error : ""), !digest.error && digest.rows[0].a === 1, JSON.stringify(digest));
      await h.as(coach);
      const digestBlocked = await tryQ(db, `select * from public.coach_digest_activity($1, $2::uuid[])`, [coach, [g1]]);
      h.check("a signed-in coach cannot call the server-only digest function", !!digestBlocked.error);

      // ---- values must be real
      await h.asSuper();
      const s1 = (await db.query(`insert into public.athlete_sessions (group_id, athlete_id, status, started_at) values ($1, $2, 'in_progress', now()) returning id`, [g1, a1])).rows[0].id;
      const e1 = (await db.query(`insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, 'Squat', 0) returning id`, [s1])).rows[0].id;
      const ins = (cols) => tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, rpe, status) values ($1, $2, $3, $4, $5, 'pending') returning id`, [e1, cols.order, cols.weight ?? null, cols.reps ?? null, cols.rpe ?? null]);
      h.check("a normal set saves", !(await ins({ order: 0, weight: 225, reps: 5, rpe: 8 })).error);
      h.check("a weight of 5280 is refused", !!(await ins({ order: 1, weight: 5280, reps: 12 })).error);
      h.check("an effort of 48 is refused", !!(await ins({ order: 2, weight: 205, reps: 12, rpe: 48 })).error);
      h.check("a negative weight is refused", !!(await ins({ order: 3, weight: -5, reps: 5 })).error);
      const flagged = await tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, status, data_flag) values ($1, 4, 5280, 12, 'pending', 'unclear') returning id`, [e1]);
      h.check("a value already flagged unclear is exempt (the way to hold a value nobody trusts yet)" + (flagged.error ? ": " + flagged.error : ""), !flagged.error);

      // ---- the mark on test organizations
      const col = await h.one(`select data_type, column_default from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'is_test'`);
      h.check("organizations have an is_test mark that starts false", col.data_type === 'boolean' && /false/.test(String(col.column_default)), JSON.stringify(col));

      // ---- stale workouts
      const old = (await db.query(`insert into public.athlete_sessions (group_id, athlete_id, status, started_at) values ($1, $2, 'in_progress', now() - interval '5 days') returning id`, [g2, a2])).rows[0].id;
      // started 5 days ago but resumed just now (a paused workout the client picked back up)
      const resumed = (await db.query(`insert into public.athlete_sessions (group_id, athlete_id, status, started_at, resumed_at) values ($1, $2, 'in_progress', now() - interval '5 days', now() - interval '1 hour') returning id`, [g2, a2])).rows[0].id;
      // started 5 days ago but a set was saved today (being logged right now)
      const logging = (await db.query(`insert into public.athlete_sessions (group_id, athlete_id, status, started_at) values ($1, $2, 'in_progress', now() - interval '5 days') returning id`, [g2, a2])).rows[0].id;
      const logEx = (await db.query(`insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, 'Row', 0) returning id`, [logging])).rows[0].id;
      await db.query(`insert into public.set_logs (session_exercise_id, set_order, weight, reps, status, completed_at) values ($1, 0, 100, 5, 'completed', now() - interval '2 hours')`, [logEx]);
      const closed = await tryQ(db, `select public.close_stale_sessions(3) as n`);
      h.check("the closer runs for the server" + (closed.error ? ": " + closed.error : ""), !closed.error && closed.rows[0].n >= 1, JSON.stringify(closed));
      const st = await db.query(`select id, status from public.athlete_sessions where id in ($1, $2, $3, $4)`, [old, s1, resumed, logging]);
      const statusOf = Object.fromEntries(st.rows.map((r) => [r.id, r.status]));
      h.check("the old workout is paused and today's is left alone", statusOf[old] === "abandoned" && statusOf[s1] === "in_progress", JSON.stringify(statusOf));
      h.check("a workout resumed an hour ago is left alone, though it was started 5 days ago", statusOf[resumed] === "in_progress", JSON.stringify(statusOf));
      h.check("a workout with a set saved today is left alone, though it was started 5 days ago", statusOf[logging] === "in_progress", JSON.stringify(statusOf));
      await h.as(coach);
      const blocked = await tryQ(db, `select public.close_stale_sessions(3)`);
      h.check("a signed-in person cannot call it", !!blocked.error);
      await h.asSuper();
      const bad = await tryQ(db, `select public.close_stale_sessions(0)`);
      h.check("zero days is refused", !!bad.error);

      // ---- indexes
      const idx = await db.query(`select indexname from pg_indexes where schemaname = 'public' and indexname in ('workout_logs_group_athlete_created_idx','workout_logs_group_created_idx','credit_purchases_group_created_idx','bookings_group_start_idx','nutrition_checkins_group_created_idx','set_logs_completed_at_idx','ai_usage_log_created_idx')`);
      h.check("the seven indexes exist", idx.rows.length === 7, String(idx.rows.length));
    },
  },
};
