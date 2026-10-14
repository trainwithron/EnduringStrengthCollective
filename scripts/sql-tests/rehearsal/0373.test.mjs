// 0373: the Progress tab. A coach's card choices are private to them; a pin is private to the coach who made it, for one client in a group they coach, behind the organization wall; the daily
// intake sums what a client logged, leaving out skipped meals and entries with no calories, and only the client and their coach can read it.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0373 Progress tab tables",
  migrations: ["0373"],
  phases: {
    async "0373"({ db, h }) {
      const coach = await h.user("PT Coach");
      const coach2 = await h.user("PT Second Coach");
      const stranger = await h.user("PT Other Coach");
      const client = await h.user("PT Client");
      const org = await h.org(coach);
      await h.orgMember(org, coach2, "coach");
      const group = await h.group(org, coach, "team", "PT team");
      await h.member(group, client);
      const org2 = await h.org(stranger);
      const group2 = await h.group(org2, stranger, "team", "PT other");

      await h.as(coach);
      await db.query(`insert into public.coach_progress_prefs (coach_id, view_mode, metric) values ($1, 'list', 'volume')`, [coach]);
      h.check("a coach can save their own card choices", (await db.query(`select view_mode, metric from public.coach_progress_prefs where coach_id = $1`, [coach])).rows[0]?.view_mode === "list");
      h.check("...only the two views and the two graph kinds are allowed", !!(await tryQ(db, `update public.coach_progress_prefs set view_mode = 'grid' where coach_id = $1`, [coach])).error && !!(await tryQ(db, `update public.coach_progress_prefs set metric = 'speed' where coach_id = $1`, [coach])).error);
      h.check("...a coach cannot save choices for someone else", !!(await tryQ(db, `insert into public.coach_progress_prefs (coach_id) values ($1)`, [coach2])).error);
      await h.as(stranger);
      h.check("...and cannot read another coach's choices", (await db.query(`select count(*)::int as n from public.coach_progress_prefs`)).rows[0].n === 0);

      await h.as(coach);
      await db.query(`insert into public.client_progress_pins (coach_id, athlete_id, group_id, exercise_name) values ($1, $2, $3, 'Bench Press')`, [coach, client, group]);
      h.check("a coach can pin an exercise on a client's cards", (await db.query(`select count(*)::int as n from public.client_progress_pins where athlete_id = $1`, [client])).rows[0].n === 1);
      h.check("...the same pin twice is refused", !!(await tryQ(db, `insert into public.client_progress_pins (coach_id, athlete_id, group_id, exercise_name) values ($1, $2, $3, 'Bench Press')`, [coach, client, group])).error);
      h.check("...an empty name is refused", !!(await tryQ(db, `insert into public.client_progress_pins (coach_id, athlete_id, group_id, exercise_name) values ($1, $2, $3, '  ')`, [coach, client, group])).error);
      h.check("...a coach cannot pin as another coach", !!(await tryQ(db, `insert into public.client_progress_pins (coach_id, athlete_id, group_id, exercise_name) values ($1, $2, $3, 'Squat')`, [coach2, client, group])).error);
      await h.as(coach2);
      h.check("another coach cannot see the pin (it is private to the coach who made it)", (await db.query(`select count(*)::int as n from public.client_progress_pins`)).rows[0].n === 0);
      await h.as(stranger);
      h.check("a coach of another group cannot pin on this client", !!(await tryQ(db, `insert into public.client_progress_pins (coach_id, athlete_id, group_id, exercise_name) values ($1, $2, $3, 'Squat')`, [stranger, client, group])).error);
      await h.as(client);
      h.check("the client does not see their coach's pins", (await db.query(`select count(*)::int as n from public.client_progress_pins`)).rows[0].n === 0);
      await h.as(coach);
      const unpin = await db.query(`delete from public.client_progress_pins where athlete_id = $1 and exercise_name = 'Bench Press' returning exercise_name`, [client]);
      h.check("a coach can unpin", unpin.rows.length === 1);

      // daily intake
      await h.asSuper();
      const meal = (day, status, calories) =>
        db.query(`insert into public.food_log_entries (athlete_id, group_id, log_date, status, calories) values ($1, $2, $3, $4, $5)`, [client, group, day, status, calories]);
      await meal("2026-08-01", "quick_log", 500);
      await meal("2026-08-01", "modified", 700);
      await meal("2026-08-01", "skipped", 400);
      await meal("2026-08-01", "ate_it", null);
      await meal("2026-08-02", "quick_log", 300);
      await h.as(client);
      const own = (await db.query(`select to_char(log_date, 'YYYY-MM-DD') as d, calories::int as c from public.client_daily_intake($1, $2) order by log_date`, [client, group])).rows;
      h.check("the day's calories add up, leaving out skipped meals and entries with no calories", own.length === 2 && own[0].d === "2026-08-01" && own[0].c === 1200 && own[1].c === 300);
      await h.as(coach);
      h.check("the coach reads the same", (await db.query(`select count(*)::int as n from public.client_daily_intake($1, $2)`, [client, group])).rows[0].n === 2);
      await h.as(stranger);
      h.check("a coach of another group reads nothing", (await db.query(`select count(*)::int as n from public.client_daily_intake($1, $2)`, [client, group])).rows[0].n === 0);
      await h.asSuper();
      h.check("the other group has no pins", (await db.query(`select count(*)::int as n from public.client_progress_pins where group_id = $1`, [group2])).rows[0].n === 0);
    },
  },
};
