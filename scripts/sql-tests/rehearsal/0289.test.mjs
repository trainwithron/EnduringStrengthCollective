// 0289: a window of hours can be tagged with one of the coach's own session types; a booking made inside a tagged window is tagged the same, automatically.
// Nothing changes for a window with no tag, a booking that already has a type keeps it, credits are untouched, and deleting a type never deletes a window.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0289 session type on a window of hours",
  migrations: ["0289"],
  phases: {
    async "0288"({ db, h }) {
      const c = await h.one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'coach_availability_windows' and column_name = 'session_type_id'`);
      h.check("baseline: a window has no session type column yet", c.n === 0, JSON.stringify(c));
    },

    async "0289"({ db, h }) {
      const coach = await h.user("V1 Coach");
      const other = await h.user("V1 Other Coach");
      const ann = await h.user("V1 Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "V1 group");
      await h.member(group, ann);
      await h.asSuper();
      const online = (await db.query(`insert into public.session_types (coach_id, name, credit_cost) values ($1, 'Online', 1) returning id`, [coach])).rows[0].id;
      const inPerson = (await db.query(`insert into public.session_types (coach_id, name, credit_cost) values ($1, 'In person', 1) returning id`, [coach])).rows[0].id;
      const tz = (await h.one(`select coalesce(public.coach_time_zone($1), 'America/New_York') as tz`, [coach])).tz;
      // Every weekday: 06:00 to 12:00 online, 12:00 to 18:00 in person, 18:00 to 20:00 with no type.
      for (let d = 0; d < 7; d++) {
        await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes, session_type_id) values ($1, $2, '06:00', '12:00', 60, $3), ($1, $2, '12:00', '18:00', 60, $4), ($1, $2, '18:00', '20:00', 60, null)`, [coach, d, online, inPerson]);
      }
      const local = (hh, mm, plusDays) => `(date_trunc('day', (now() at time zone '${tz}')) + interval '${plusDays} days' + interval '${hh} hours ${mm} minutes') at time zone '${tz}'`;
      const book = async (sh, sm, eh, em, day, extraCols = "", extraVals = "") =>
        (await tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status${extraCols}) values ($1, $2, $3, ${local(sh, sm, day)}, ${local(eh, em, day)}, 'confirmed'${extraVals}) returning session_type_id`, [coach, ann, group]));

      const am = await book(7, 0, 7, 55, 40);
      const pm = await book(14, 0, 14, 55, 40);
      const none = await book(19, 0, 19, 55, 40);
      const across = await book(11, 30, 12, 25, 41); // runs across the 12:00 boundary: no single window holds it
      h.check("a booking inside the online hours is tagged Online", am.rows?.[0]?.session_type_id === online, JSON.stringify(am));
      h.check("a booking inside the in-person hours is tagged In person", pm.rows?.[0]?.session_type_id === inPerson, JSON.stringify(pm));
      h.check("a booking inside hours with no tag stays untagged", none.rows?.[0]?.session_type_id === null, JSON.stringify(none));
      h.check("a booking that runs across two windows is not tagged (no single window holds it)", across.rows?.[0]?.session_type_id === null, JSON.stringify(across));

      const keeps = await book(8, 0, 8, 55, 42, ", session_type_id", `, '${inPerson}'`);
      h.check("a booking that already has a type keeps it", keeps.rows?.[0]?.session_type_id === inPerson, JSON.stringify(keeps));

      // the coach changes a booking's type afterwards; another coach cannot set a window's tag on someone else's hours
      await h.as(coach);
      const change = await tryQ(db, `update public.bookings set session_type_id = $1 where coach_id = $2 and session_type_id = $3 returning id`, [inPerson, coach, online]);
      const tagOwn = await tryQ(db, `update public.coach_availability_windows set session_type_id = $1 where coach_id = $2 and weekday = 1 and start_time = '18:00' returning id`, [online, coach]);
      await h.as(other);
      const tagOthers = await tryQ(db, `update public.coach_availability_windows set session_type_id = $1 where coach_id = $2 returning id`, [online, coach]);
      await h.asSuper();
      h.check("the coach can change the type of a booking afterwards", !change.error && (change.rows ?? []).length >= 1, JSON.stringify(change));
      h.check("the coach can tag their own window", !tagOwn.error && (tagOwn.rows ?? []).length === 1, JSON.stringify(tagOwn));
      h.check("another coach cannot tag someone else's hours", (tagOthers.rows ?? []).length === 0, JSON.stringify(tagOthers));

      // credits are untouched by the tag
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5) on conflict (athlete_id, group_id) do update set balance = 5`, [ann, group]);
      await h.as(coach);
      const viaFn = await tryQ(db, `select public.book_session($1, $2, $3, ${local(9, 0, 43)}, ${local(9, 55, 43)}) as id`, [coach, ann, group]);
      await h.asSuper();
      const credits = await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [ann, group]);
      const tagged = await h.one(`select session_type_id from public.bookings where id = $1`, [viaFn.rows?.[0]?.id]);
      h.check("booking through the normal function inside a tagged window works, is tagged, and a coach booking spends no credit", !viaFn.error && tagged.session_type_id === online && credits.balance === 5, JSON.stringify({ viaFn, tagged, credits }));

      // deleting a type clears the tag, never the window
      const before = await h.one(`select count(*)::int as n from public.coach_availability_windows where coach_id = $1`, [coach]);
      await db.query(`delete from public.session_types where id = $1`, [inPerson]);
      const after = await h.one(`select count(*)::int as n, count(*) filter (where session_type_id is not null)::int as tagged from public.coach_availability_windows where coach_id = $1`, [coach]);
      h.check("deleting a session type clears the tag on its windows (only the 8 Online ones stay tagged) and deletes no window", after.n === before.n && after.tagged === 8, JSON.stringify({ before, after }));

      // the function is a trigger only
      const acl = await h.one(`select has_function_privilege('authenticated', 'public.tag_booking_session_type()', 'execute') as auth, has_function_privilege('anon', 'public.tag_booking_session_type()', 'execute') as anon`);
      h.check("nobody signed in or out can call the trigger function directly", acl.auth === false && acl.anon === false, JSON.stringify(acl));
    },
  },
};
