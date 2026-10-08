// 0312: a client booking or moving their own session must stay inside the coach's open hours and clear of time off. Before 0312 the server did not check the hours for a
// direct booking (only the screens hid off-hours times). A coach booking for a client, a coach who is their own client, and the server's routines are never refused.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0312 booking inside the coach's hours (server check)",
  migrations: ["0312"],
  phases: {
    async "0312"({ db, h }) {
      const coach = await h.user("BH Coach");
      const ann = await h.user("BH Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "BH group");
      await h.member(group, ann);
      await h.asSuper();
      await db.query("insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 20)", [ann, group]);
      await db.query("insert into public.coach_booking_policies (coach_id, booking_mode) values ($1, 'free') on conflict (coach_id) do update set booking_mode = 'free'", [coach]);
      // Open Tuesday to Thursday, 09:00 to 17:00 in the coach's time zone (New York when none is set).
      for (const dow of [2, 3, 4]) {
        await db.query("insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes) values ($1, $2, '09:00', '17:00', 60)", [coach, dow]);
      }
      // the first Wednesday at least 10 days out, and the Saturday after it, as local New York times
      const days = (await h.one("select (d + ((3 - extract(dow from d)::int + 7) % 7)) as wed from (select current_date + 10 as d) x")).wed;
      const local = async (offsetDays, time) => (await h.one("select (((($1::date + $2::int) + $3::time) at time zone 'America/New_York'))::text as t", [days, offsetDays, time])).t;
      const wed10 = await local(0, "10:00");
      const wed1100 = await local(0, "11:00");
      const wed0800 = await local(0, "08:00");
      const wed0900 = await local(0, "09:00");
      const wed1630 = await local(0, "16:30");
      const wed1730 = await local(0, "17:30");
      const sat10 = await local(3, "10:00");
      const sat11 = await local(3, "11:00");
      const book = (start, end, who = ann) => tryQ(db, "select public.book_session($1, $2, $3, $4::timestamptz, $5::timestamptz) as id", [coach, who, group, start, end]);

      // a client, inside the hours
      await h.as(ann);
      const inside = await book(wed10, wed1100);
      h.check("a client can book inside the coach's open hours", !inside.error && !!inside.rows?.[0]?.id, JSON.stringify(inside));
      const insideEdge = await book(wed0900, wed10);
      h.check("a session starting exactly when the window opens is fine", !insideEdge.error, JSON.stringify(insideEdge));
      const endEdge = await book(await local(0, "16:00"), await local(0, "17:00"));
      h.check("a session ending exactly when the window closes is fine", !endEdge.error, JSON.stringify(endEdge));

      // a client, outside
      const early = await book(wed0800, wed0900);
      const late = await book(wed1730, await local(0, "18:30"));
      const spill = await book(wed1630, wed1730);
      const wrongDay = await book(sat10, sat11);
      h.check("a client cannot book before the window opens", /outside your coach's hours/.test(early.error ?? ""), JSON.stringify(early));
      h.check("a client cannot book after the window closes", /outside your coach's hours/.test(late.error ?? ""), JSON.stringify(late));
      h.check("a client cannot book a session that runs past the end of the window", /outside your coach's hours/.test(spill.error ?? ""), JSON.stringify(spill));
      h.check("a client cannot book on a day with no hours", /outside your coach's hours/.test(wrongDay.error ?? ""), JSON.stringify(wrongDay));
      await h.asSuper();
      const refusedCount = (await h.one("select count(*)::int as c from public.bookings where athlete_id = $1", [ann])).c;
      const credits = (await h.one("select balance from public.session_credits where athlete_id = $1 and group_id = $2", [ann, group])).balance;
      h.check("a refused booking leaves no booking and takes no credit (3 booked, 17 credits left)", refusedCount === 3 && credits === 17, JSON.stringify({ refusedCount, credits }));

      // time off
      await db.query("insert into public.coach_availability_exceptions (coach_id, kind, start_at, end_at) values ($1, 'one_off', $2::timestamptz, $3::timestamptz)", [coach, await local(0, "13:00"), await local(0, "15:00")]);
      await h.as(ann);
      const off = await book(await local(0, "13:30"), await local(0, "14:30"));
      const beforeOff = await book(await local(0, "12:00"), await local(0, "13:00"));
      h.check("a client cannot book into the coach's time off", /outside your coach's hours/.test(off.error ?? ""), JSON.stringify(off));
      h.check("the hour right before the time off is fine", !beforeOff.error, JSON.stringify(beforeOff));

      // reschedule: the client moves their own session
      const bookingId = inside.rows[0].id;
      const moveIn = await tryQ(db, "select public.reschedule_booking($1, $2::timestamptz, $3::timestamptz)", [bookingId, await local(0, "15:00"), await local(0, "16:00")]);
      const moveOut = await tryQ(db, "select public.reschedule_booking($1, $2::timestamptz, $3::timestamptz)", [bookingId, sat10, sat11]);
      const moveOff = await tryQ(db, "select public.reschedule_booking($1, $2::timestamptz, $3::timestamptz)", [bookingId, await local(0, "13:00"), await local(0, "14:00")]);
      h.check("a client can move their session to another time inside the hours", !moveIn.error, JSON.stringify(moveIn));
      h.check("a client cannot move their session outside the hours", /outside your coach's hours/.test(moveOut.error ?? ""), JSON.stringify(moveOut));
      h.check("a client cannot move their session into time off", /outside your coach's hours/.test(moveOff.error ?? ""), JSON.stringify(moveOff));
      await h.asSuper();
      const stays = (await h.one("select start_at = $2::timestamptz as same from public.bookings where id = $1", [bookingId, await local(0, "15:00")])).same;
      h.check("a refused move leaves the session where the last good move put it", stays === true);

      // a coach is never refused
      await h.as(coach);
      const byCoach = await book(sat10, sat11);
      h.check("a coach can book a client outside the open hours", !byCoach.error && !!byCoach.rows?.[0]?.id, JSON.stringify(byCoach));
      await h.asSuper();
      await h.asService();
      const bySvc = await book(await local(4, "07:00"), await local(4, "08:00"));
      await h.asSuper();
      h.check("the server (service role) can book a client outside the hours", !bySvc.error && !!bySvc.rows?.[0]?.id, JSON.stringify(bySvc));

      // a weekly schedule the client starts books each week through book_session
      await h.as(ann);
      const weekly = await tryQ(db, "select * from public.create_recurring_booking_series($1, $2, $3, $4::timestamptz, 60, 3)", [coach, ann, group, await local(14, "10:00")]);
      const weeklyBad = await tryQ(db, "select * from public.create_recurring_booking_series($1, $2, $3, $4::timestamptz, 60, 3)", [coach, ann, group, await local(3, "10:00")]);
      await h.asSuper();
      h.check("a weekly schedule inside the hours books every week", !weekly.error && weekly.rows?.[0]?.booked_count === 3, JSON.stringify(weekly));
      h.check("a weekly schedule on a day with no hours books nothing", weeklyBad.error ? true : weeklyBad.rows?.[0]?.booked_count === 0, JSON.stringify(weeklyBad));

      // rights unchanged
      const acl = await h.one(
        "select has_function_privilege('authenticated', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute') as a, has_function_privilege('service_role', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute') as s, has_function_privilege('anon', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute') as n, has_function_privilege('authenticated', 'public.reschedule_booking(uuid, timestamptz, timestamptz)', 'execute') as ra, has_function_privilege('anon', 'public.reschedule_booking(uuid, timestamptz, timestamptz)', 'execute') as rn, (select prosecdef from pg_proc where proname = 'book_session' and pronamespace = 'public'::regnamespace) as bd, (select prosecdef from pg_proc where proname = 'reschedule_booking' and pronamespace = 'public'::regnamespace) as rd"
      );
      h.check("the rights on both functions are unchanged: signed-in users and the server, not signed-out visitors; both still run as the owner", acl.a && acl.s && !acl.n && acl.ra && !acl.rn && acl.bd && acl.rd, JSON.stringify(acl));
    },
  },
};
