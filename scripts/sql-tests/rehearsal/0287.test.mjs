// 0287: a session can be longer than the time between slot starts (a start every 15 minutes for a 55-minute session). The session length stays 5 to 480 and
// must fit inside its window. Existing windows are untouched, a coach changes only their own, and booking one start blocks the starts it overlaps.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0287 session longer than the slot step",
  migrations: ["0287"],
  phases: {
    async "0286"({ db, h }) {
      const coach = await h.user("T1 Coach");
      const org = await h.org(coach);
      await h.group(org, coach, "one_on_one", "T1 group");
      await h.asSuper();
      const w = (await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes) values ($1, 2, '06:00', '12:00', 15) returning id`, [coach])).rows[0].id;
      const refused = await tryQ(db, `update public.coach_availability_windows set session_minutes = 55 where id = $1`, [w]);
      h.check("baseline: before 0287 a 55-minute session in a 15-minute step is refused (the rule 0287 relaxes)", !!refused.error, JSON.stringify(refused));
    },

    async "0287"({ db, h }) {
      const coach = await h.user("T2 Coach");
      const other = await h.user("T2 Other Coach");
      const ann = await h.user("T2 Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "T2 group");
      await h.member(group, ann);
      await h.asSuper();
      const w = (await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes, session_minutes) values ($1, 2, '06:00', '10:00', 60, 55) returning id`, [coach])).rows[0].id;
      const untouched = await h.one(`select slot_duration_minutes, session_minutes from public.coach_availability_windows where id = $1`, [w]);
      h.check("an existing window keeps its step and its session length", untouched.slot_duration_minutes === 60 && untouched.session_minutes === 55, JSON.stringify(untouched));

      await h.as(coach);
      const step15 = await tryQ(db, `update public.coach_availability_windows set slot_duration_minutes = 15, session_minutes = 55 where id = $1 returning slot_duration_minutes, session_minutes`, [w]);
      const longer = await tryQ(db, `update public.coach_availability_windows set slot_duration_minutes = 5, session_minutes = 90 where id = $1 returning session_minutes`, [w]);
      const bad = [];
      for (const v of [2, 481, 241]) bad.push(await tryQ(db, `update public.coach_availability_windows set session_minutes = $2 where id = $1`, [w, v]));
      await h.as(other);
      const byOther = await tryQ(db, `update public.coach_availability_windows set session_minutes = 40 where id = $1 returning session_minutes`, [w]);
      await h.asSuper();
      h.check("a start every 15 minutes with a 55-minute session is accepted", !step15.error && step15.rows?.[0]?.slot_duration_minutes === 15 && step15.rows?.[0]?.session_minutes === 55, JSON.stringify(step15));
      h.check("a session longer than the step is accepted when it fits the window (a 90-minute session on a 5-minute step in a 4-hour window)", !longer.error && longer.rows?.[0]?.session_minutes === 90, JSON.stringify(longer));
      h.check("under 5, over 480, or longer than the window itself (241 minutes in a 240-minute window) is still refused", bad.every((r) => !!r.error), JSON.stringify(bad));
      h.check("another coach cannot change it", (byOther.rows ?? []).length === 0, JSON.stringify(byOther));

      // booking: with a 15-minute step and 55-minute sessions, booking 10:00 blocks the starts it overlaps and allows the first start after it ends
      await db.query(`update public.coach_availability_windows set slot_duration_minutes = 15, session_minutes = 55 where id = $1`, [w]);
      for (let d = 0; d < 7; d++) {
        if (d === 2) continue;
        await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes, session_minutes) values ($1, $2, '06:00', '20:00', 15, 55)`, [coach, d]);
      }
      await db.query(`insert into public.coach_booking_policies (coach_id, buffer_minutes) values ($1, 0) on conflict (coach_id) do update set buffer_minutes = 0`, [coach]);
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5)`, [ann, group]);
      const tz = (await h.one(`select coalesce(public.coach_time_zone($1), 'America/New_York') as tz`, [coach])).tz;
      const local = (hh, mm, plusDays) => `(date_trunc('day', (now() at time zone '${tz}')) + interval '${plusDays} days' + interval '${hh} hours ${mm} minutes') at time zone '${tz}'`;
      await h.as(coach);
      const first = await tryQ(db, `select public.book_session($1, $2, $3, ${local(10, 0, 9)}, ${local(10, 55, 9)}) as id`, [coach, ann, group]);
      const overlapping = await tryQ(db, `select public.book_session($1, $2, $3, ${local(10, 15, 9)}, ${local(11, 10, 9)})`, [coach, ann, group]);
      const offGrid = await tryQ(db, `select public.book_session($1, $2, $3, ${local(11, 20, 9)}, ${local(12, 15, 9)}) as id`, [coach, ann, group]);
      const next = await tryQ(db, `select public.book_session($1, $2, $3, ${local(10, 55, 9)}, ${local(11, 25, 9)}) as id`, [coach, ann, group]);
      await h.asSuper();
      h.check("the 10:00 to 10:55 session is booked", !first.error, JSON.stringify(first));
      h.check("a start at 10:15 (which overlaps it) is refused", /buffer|conflict|already|taken|unavailable|overlap/i.test(overlapping.error ?? ""), JSON.stringify(overlapping));
      h.check("a session at an off-grid minute (11:20 to 12:15) is accepted: the database does not require slot alignment", !offGrid.error, JSON.stringify(offGrid));
      h.check("a session that would run into the 11:20 one is refused", /buffer|conflict|already|taken|unavailable|overlap/i.test(next.error ?? ""), JSON.stringify(next));
    },
  },
};
