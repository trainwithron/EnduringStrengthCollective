// 0283: a window can have a session length that differs from the slot step (55-minute sessions in 60-minute slots). Null means the same as the step, so
// nothing changes for anyone who does not set it. A coach changes only their own windows; the length is checked (5 to 480, never longer than the step).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0283 session length separate from the slot step",
  migrations: ["0283"],
  phases: {
    async "0282"({ db, h }) {
      const c = await h.one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_minutes'`);
      h.check("baseline: a window has only the slot step (what 0283 adds a session length to)", c.n === 0, JSON.stringify(c));
    },

    async "0283"({ db, h }) {
      const coach = await h.user("S1 Coach");
      const other = await h.user("S1 Other Coach");
      const ann = await h.user("S1 Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "S1 group");
      await h.member(group, ann);
      await h.asSuper();
      const w = (await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes) values ($1, 2, '06:00', '17:00', 60) returning id`, [coach])).rows[0].id;

      const before = await h.one(`select session_minutes from public.coach_availability_windows where id = $1`, [w]);
      h.check("an existing window has no session length (null: the same as the step)", before.session_minutes === null, JSON.stringify(before));

      await h.as(coach);
      const set55 = await tryQ(db, `update public.coach_availability_windows set session_minutes = 55 where id = $1 returning session_minutes`, [w]);
      await h.as(other);
      const byOther = await tryQ(db, `update public.coach_availability_windows set session_minutes = 40 where id = $1 returning session_minutes`, [w]);
      await h.as(ann);
      const seenByClient = await tryQ(db, `select session_minutes from public.coach_availability_windows where id = $1`, [w]);
      await h.as(coach);
      const bad = [];
      for (const v of [2, 481, 61]) bad.push(await tryQ(db, `update public.coach_availability_windows set session_minutes = $2 where id = $1`, [w, v]));
      const clear = await tryQ(db, `update public.coach_availability_windows set session_minutes = null where id = $1 returning session_minutes`, [w]);
      await h.asSuper();
      h.check("the coach sets 55 minutes on their own window", !set55.error && set55.rows?.[0]?.session_minutes === 55, JSON.stringify(set55));
      h.check("another coach cannot change it", (byOther.rows ?? []).length === 0 && !byOther.error || !!byOther.error, JSON.stringify(byOther));
      h.check("the coach's own client can read it (so their booking screen uses it)", seenByClient.rows?.[0]?.session_minutes === 55, JSON.stringify(seenByClient));
      h.check("under 5, over 480, or longer than the step is refused", bad.every((r) => !!r.error), JSON.stringify(bad));
      h.check("the coach can clear it back to the same as the step", !clear.error && clear.rows?.[0]?.session_minutes === null, JSON.stringify(clear));

      // a 55-minute session at 10:00 then another at 11:00 (coach's clock) works with a buffer of 5; the booking functions are unchanged and take the end
      // from the caller. Hours for every weekday so the fixture day never matters.
      for (let d = 0; d < 7; d++) {
        if (d === 2) continue;
        await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes, session_minutes) values ($1, $2, '06:00', '20:00', 60, 55)`, [coach, d]);
      }
      await db.query(`update public.coach_availability_windows set session_minutes = 55 where id = $1`, [w]);
      await db.query(`insert into public.coach_booking_policies (coach_id, buffer_minutes) values ($1, 5) on conflict (coach_id) do update set buffer_minutes = 5`, [coach]);
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5)`, [ann, group]);
      const tz = (await h.one(`select coalesce(public.coach_time_zone($1), 'America/New_York') as tz`, [coach])).tz;
      const local = (hh, mm, plusDays) => `(date_trunc('day', (now() at time zone '${tz}')) + interval '${plusDays} days' + interval '${hh} hours ${mm} minutes') at time zone '${tz}'`;
      const ids = [];
      for (const [sh, sm, eh, em] of [[10, 0, 10, 55], [11, 0, 11, 55]]) {
        await h.as(coach);
        const r = await tryQ(db, `select public.book_session($1, $2, $3, ${local(sh, sm, 9)}, ${local(eh, em, 9)}) as id`, [coach, ann, group]);
        await h.asSuper();
        ids.push(r);
      }
      h.check("with a buffer of 5, a 55-minute session at 10:00 and another at 11:00 are both accepted", ids.every((r) => !r.error), JSON.stringify(ids));
      await h.as(coach);
      const tooClose = await tryQ(db, `select public.book_session($1, $2, $3, ${local(11, 56, 9)}, ${local(12, 51, 9)})`, [coach, ann, group]);
      await h.asSuper();
      h.check("a session starting less than the buffer after the previous one ends (11:56 after 11:55) is refused", /buffer|conflict|already|taken|unavailable|overlap/i.test(tooClose.error ?? ""), JSON.stringify(tooClose));
    },
  },
};
