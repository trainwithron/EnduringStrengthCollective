// 0374: a coach asks the client to count a record from imported history; the client says yes or not now. A yes gives that one imported workout a real workout log dated when it was done;
// a not now can be asked again only after 30 days; nothing else changes, and a backdated log never brings an inactive client back.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0374 Promote an imported record",
  migrations: ["0374"],
  phases: {
    async "0374"({ db, h }) {
      const coach = await h.user("PP Coach");
      const coach2 = await h.user("PP Second Coach");
      const stranger = await h.user("PP Other Coach");
      const client = await h.user("PP Client");
      const org = await h.org(coach);
      await h.orgMember(org, coach2, "coach");
      const group = await h.group(org, coach, "team", "PP team");
      await h.member(group, client);
      const org2 = await h.org(stranger);
      await h.group(org2, stranger, "team", "PP other");

      await h.asSuper();
      const session = async (day, historical) =>
        (await db.query(
          `insert into public.athlete_sessions (group_id, athlete_id, status, is_historical, started_at, completed_at, duration_seconds) values ($1, $2, 'completed', $3, $4, $4, 3000) returning id`,
          [group, client, historical, `2025-03-${String(day).padStart(2, "0")}T12:00:17Z`]
        )).rows[0].id;
      const exercise = async (sid, name) => (await db.query(`insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, $2, 0) returning id`, [sid, name])).rows[0].id;
      const set = (eid, order, weight, reps, flag = null) =>
        db.query(`insert into public.set_logs (session_exercise_id, set_order, weight, reps, status, completed_at, is_historical, data_flag) values ($1, $2, $3, $4, 'completed', now(), true, $5)`, [eid, order, weight, reps, flag]);

      const imported = await session(10, true);
      const ex = await exercise(imported, "Deadlift");
      await set(ex, 0, 900, 1);
      await set(ex, 1, 700, 3);
      await set(ex, 2, 5000, 1, "unclear"); // an unclear point is never the weight asked about
      const bench = await exercise(imported, "Bench Press");
      await set(bench, 0, 300, 3);
      const live = await db.query(`insert into public.athlete_sessions (group_id, athlete_id, status, is_historical, started_at, completed_at) values ($1, $2, 'completed', false, now(), now()) returning id`, [group, client]);
      const liveEx = await exercise(live.rows[0].id, "Squat");
      await db.query(`insert into public.set_logs (session_exercise_id, set_order, weight, reps, status, completed_at) values ($1, 0, 400, 1, 'completed', now())`, [liveEx]);

      // asking
      await h.as(client);
      h.check("a client cannot ask for their own record to count", !!(await tryQ(db, `select public.ask_pr_promotion($1, 'Deadlift')`, [imported])).error);
      await h.as(stranger);
      h.check("a coach of another group cannot ask", !!(await tryQ(db, `select public.ask_pr_promotion($1, 'Deadlift')`, [imported])).error);
      await h.as(coach);
      h.check("a live workout cannot be asked about (only imported history)", !!(await tryQ(db, `select public.ask_pr_promotion($1, 'Squat')`, [live.rows[0].id])).error);
      h.check("an exercise with no counted weight cannot be asked about", !!(await tryQ(db, `select public.ask_pr_promotion($1, 'Plank')`, [imported])).error);
      const asked = await tryQ(db, `select public.ask_pr_promotion($1, 'Deadlift') as id`, [imported]);
      h.check("the coach can ask" + (asked.error ? ": " + asked.error : ""), !asked.error && !!asked.rows?.[0]?.id);
      const id = asked.rows[0].id;
      const again = await tryQ(db, `select public.ask_pr_promotion($1, 'Deadlift') as id`, [imported]);
      h.check("asking again while it is open gives the same ask, not a second one", again.rows?.[0]?.id === id);
      const row = (await db.query(`select weight, status from public.pr_promotions where id = $1`, [id])).rows[0];
      h.check("the weight asked about is the heaviest COUNTED set (900, not the unclear 5000)", Number(row.weight) === 900 && row.status === "asked");

      await h.as(client);
      const notes = (await db.query(`select body, link_path, type from public.notifications where profile_id = $1 and type = 'pr_promotion'`, [client])).rows;
      h.check("the client got exactly one notification, in plain words, linking to the answer page", notes.length === 1 && notes[0].body === "Your coach wants to count your 900 lb Deadlift from March 2025 as a PR." && notes[0].link_path === "/pr-promotion/" + id);
      h.check("the client can read the ask", (await db.query(`select count(*)::int as n from public.pr_promotions`)).rows[0].n === 1);
      await h.as(coach2);
      h.check("another coach does not see the ask (it is the asking coach's)", (await db.query(`select count(*)::int as n from public.pr_promotions`)).rows[0].n === 0);
      await h.as(stranger);
      h.check("a coach of another group does not see it", (await db.query(`select count(*)::int as n from public.pr_promotions`)).rows[0].n === 0);

      // answering: only the client
      await h.as(coach);
      h.check("the coach cannot answer for the client", !!(await tryQ(db, `select public.answer_pr_promotion($1, true)`, [id])).error);
      h.check("nobody writes the asks directly", !!(await tryQ(db, `update public.pr_promotions set status = 'agreed' where id = $1`, [id])).error || (await db.query(`select status from public.pr_promotions where id = $1`, [id])).rows[0].status === "asked");

      // not now, then the 30-day rule
      await h.as(client);
      const no = await tryQ(db, `select public.answer_pr_promotion($1, false) as log`, [id]);
      h.check("the client can say not now (no workout log)", !no.error && no.rows[0].log === null);
      await h.as(coach);
      h.check("the coach cannot ask again straight away", !!(await tryQ(db, `select public.ask_pr_promotion($1, 'Deadlift')`, [imported])).error);
      await h.asSuper();
      await db.query(`update public.pr_promotions set answered_at = now() - interval '31 days' where id = $1`, [id]);
      await h.as(coach);
      const reask = await tryQ(db, `select public.ask_pr_promotion($1, 'Deadlift') as id`, [imported]);
      h.check("after 30 days the coach can ask once more (same ask, open again)", reask.rows?.[0]?.id === id);
      await h.as(client);
      h.check("...with a second notification", (await db.query(`select count(*)::int as n from public.notifications where profile_id = $1 and type = 'pr_promotion'`, [client])).rows[0].n === 2);

      // yes: a real workout log with the original date; an inactive client stays inactive
      await h.asSuper();
      await db.query(`insert into public.client_inactive (athlete_id, group_id) values ($1, $2)`, [client, group]);
      const logsBefore = (await db.query(`select count(*)::int as n from public.workout_logs`)).rows[0].n;
      const postsBefore = (await db.query(`select count(*)::int as n from public.posts`)).rows[0].n;
      await h.as(client);
      const yes = await tryQ(db, `select public.answer_pr_promotion($1, true) as log`, [id]);
      h.check("the client can say yes" + (yes.error ? ": " + yes.error : ""), !yes.error && !!yes.rows[0].log);
      const logId = yes.rows[0].log;
      await h.asSuper();
      const log = (await db.query(`select session_id, athlete_id, group_id, total_volume, total_sets_completed, total_duration_seconds, new_prs, logged_by_coach, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day from public.workout_logs where id = $1`, [logId])).rows[0];
      h.check("it is a real workout log of that imported workout, dated when the workout was done", log.session_id === imported && log.day === "2025-03-10");
      h.check("...with the volume and sets of its counted sets (unclear point left out), and the record listed", Number(log.total_volume) === 900 * 1 + 700 * 3 + 300 * 3 && log.total_sets_completed === 3 && log.new_prs.includes("Deadlift") && log.logged_by_coach === false);
      h.check("...exactly one new log and no feed post (the app makes that)", (await db.query(`select count(*)::int as n from public.workout_logs`)).rows[0].n === logsBefore + 1 && (await db.query(`select count(*)::int as n from public.posts`)).rows[0].n === postsBefore);
      h.check("...and a backdated log does not bring the inactive client back", (await db.query(`select count(*)::int as n from public.client_inactive where athlete_id = $1`, [client])).rows[0].n === 1);
      h.check("the ask is agreed, with the log", (await db.query(`select status, workout_log_id from public.pr_promotions where id = $1`, [id])).rows[0].status === "agreed");
      await h.as(client);
      const twice = await tryQ(db, `select public.answer_pr_promotion($1, true) as log`, [id]);
      h.check("answering again returns the same log (nothing doubles)", twice.rows?.[0]?.log === logId);
      await h.as(coach);
      h.check("the same workout cannot be asked about again (it already counts)", !!(await tryQ(db, `select public.ask_pr_promotion($1, 'Bench Press')`, [imported])).error);
      await h.as(client);
      h.check("the rollup now sees that workout as logged, not imported-only", (await db.query(`select bool_and(has_log) as ok from public.client_exercise_rollup($1, $2) where session_id = $3`, [client, group, imported])).rows[0].ok === true);

      // a log made right now still brings an inactive client back
      await h.asSuper();
      const fresh = await session(11, false);
      await db.query(`insert into public.workout_logs (session_id, athlete_id, group_id, total_volume, total_sets_completed) values ($1, $2, $3, 100, 1)`, [fresh, client, group]);
      h.check("a workout logged today still brings an inactive client back", (await db.query(`select count(*)::int as n from public.client_inactive where athlete_id = $1`, [client])).rows[0].n === 0);
    },
  },
};
