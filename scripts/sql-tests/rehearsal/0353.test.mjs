// 0353: a coach's notice rule for pausing or ending a weekly schedule. With none set a request for today works as before; with 7 days set a request for sooner is refused with the earliest date in plain
// words, and a request at or after the notice is accepted.
export default {
  name: "0353 a coach can ask for notice before a schedule is paused or ended",
  migrations: ["0353"],
  phases: {
    async "0353"({ db, h }) {
      const owner = await h.user("SN Owner");
      const coach = await h.user("SN Coach");
      const client = await h.user("SN Client");
      const org = await h.org(owner);
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "SN team");
      await h.member(g, client);

      await h.asSuper();
      const series = (await db.query(`insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes, occurrences_total, mode) values ($1, $2, $3, 2, '09:00', 60, 4, 'ongoing') returning id`, [coach, client, g])).rows[0].id;
      const today = (await db.query(`select public.schedule_local_today(null, $1) as d`, [coach])).rows[0].d;
      const ymd = (offset) => (db.query(`select ($1::date + $2::int)::text as d`, [today, offset]));
      const day = async (n) => (await ymd(n)).rows[0].d;

      await h.as(client);
      const todayStr = typeof today === "string" ? today : (await ymd(0)).rows[0].d;
      const id1 = (await db.query(`select public.request_schedule_change($1, 'pause', $2::date) as id`, [series, todayStr])).rows[0].id;
      h.check("with no notice set, a request for today works as before", !!id1);
      await db.query(`select public.withdraw_schedule_request($1)`, [id1]);

      await h.as(coach);
      await db.query(`insert into public.coach_booking_policies (coach_id, schedule_change_notice_days) values ($1, 7) on conflict (coach_id) do update set schedule_change_notice_days = 7`, [coach]);
      await h.as(client);
      await h.expectError("with 7 days of notice, a request for sooner is refused in plain words", () => db.query(`select public.request_schedule_change($1, 'pause', $2::date)`, [series, todayStr]), /asks for 7 days notice/i);
      const ok = (await db.query(`select public.request_schedule_change($1, 'pause', $2::date) as id`, [series, await day(7)])).rows[0].id;
      h.check("a request exactly 7 days out is accepted", !!ok);
    },
  },
};
