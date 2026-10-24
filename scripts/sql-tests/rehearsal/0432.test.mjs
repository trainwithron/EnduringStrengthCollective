// 0432 Session caps, Keep my sessions together and a lunch break. A client books only what is offered; a coach can always book (past a cap too).
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0432 session caps, keep my sessions together, lunch break",
  migrations: ["0432"],
  phases: {
    async "0432"({ db, h }) {
      const coach = await h.user("SC Coach");
      const ann = await h.user("SC Ann");
      const bo = await h.user("SC Bo");
      const stranger = await h.user("SC Stranger");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "SC group");
      await h.member(group, ann);
      await h.member(group, bo);
      await h.asSuper();
      for (const who of [ann, bo]) await db.query("insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 50) on conflict do nothing", [who, group]);
      await db.query("insert into public.coach_booking_policies (coach_id, booking_mode) values ($1, 'free') on conflict (coach_id) do update set booking_mode = 'free'", [coach]);
      await db.query("update public.profiles set timezone = 'America/New_York' where id = $1", [coach]);
      // Open every day 06:00 to 17:00 (New York, the default zone), 60-minute sessions.
      for (let dow = 0; dow < 7; dow++) {
        await db.query("insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes) values ($1, $2, '06:00', '17:00', 60)", [coach, dow]);
      }
      // A Wednesday at least 10 days out (and the Thursday after it), New York local times.
      const wed = (await h.one("select (d + ((3 - extract(dow from d)::int + 7) % 7))::text as wed from (select current_date + 10 as d) x")).wed;
      const at = async (dayOffset, time) => (await h.one("select (((($1::date + $2::int) + $3::time) at time zone 'America/New_York'))::text as t", [wed, dayOffset, time])).t;
      const slot = async (dayOffset, hh) => [await at(dayOffset, `${String(hh).padStart(2, "0")}:00`), await at(dayOffset, `${String(hh + 1).padStart(2, "0")}:00`)];
      const book = async (who, [s, e]) => {
        await h.as(who);
        const r = await tryQ(db, "select public.book_session($1, $2, $3, $4::timestamptz, $5::timestamptz) as id", [coach, who, group, s, e]);
        await h.asSuper();
        return r;
      };
      const reasons = async (who, slots) => {
        await h.as(who);
        const r = await tryQ(db, "select public.client_slot_reasons($1, $2::timestamptz[], $3::timestamptz[]) as r", [coach, slots.map((x) => x[0]), slots.map((x) => x[1])]);
        await h.asSuper();
        return r;
      };

      // ---- nothing set: as before
      const plain = await book(ann, await slot(0, 7));
      h.check("with nothing set, a client books any open time as before", !plain.error, JSON.stringify(plain));
      await db.query("delete from public.bookings where coach_id = $1", [coach]);

      // ---- keep my sessions together
      await db.query("update public.coach_booking_policies set keep_together = true where coach_id = $1", [coach]);
      const empty = await reasons(ann, [await slot(0, 6), await slot(0, 7), await slot(0, 8), await slot(0, 14)]);
      h.check("an empty day offers its first 2 open times only", JSON.stringify(empty.rows?.[0]?.r) === JSON.stringify([null, null, "not_offered", "not_offered"]), JSON.stringify(empty));
      const nine = await book(bo, await slot(0, 9)).then(async (r) => (r.error ? await (async () => { await db.query("insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1,$2,$3,$4,$5,'confirmed','unsettled')", [coach, bo, group, ...(await slot(0, 9))]); return { forced: true }; })() : r));
      void nine;
      const around = await reasons(ann, [await slot(0, 6), await slot(0, 8), await slot(0, 10), await slot(0, 11)]);
      h.check("a day with a 9 AM session offers 8 and 10 (right before and right after), not 6 or 11", JSON.stringify(around.rows?.[0]?.r) === JSON.stringify(["not_offered", null, null, "not_offered"]), JSON.stringify(around));
      const scattered = await book(ann, await slot(0, 14));
      h.check("a client cannot book a scattered time on that day", /not one your coach offers/.test(scattered.error ?? ""), JSON.stringify(scattered));
      const next = await book(ann, await slot(0, 10));
      h.check("...and books the time right after", !next.error, JSON.stringify(next));
      await db.query("update public.coach_booking_policies set buffer_minutes = 15 where coach_id = $1", [coach]);
      const buffered = await reasons(ann, [await slot(0, 11), await slot(0, 12), await slot(0, 7), await slot(0, 8)]);
      h.check("with a 15-minute buffer the nearest free times are 12 and 7 (11 and 8 are inside the buffer)", JSON.stringify(buffered.rows?.[0]?.r) === JSON.stringify(["not_offered", null, null, "not_offered"]), JSON.stringify(buffered));
      await db.query("update public.coach_booking_policies set buffer_minutes = 0 where coach_id = $1", [coach]);

      // ---- lunch
      await db.query("update public.coach_booking_policies set lunch_start = '12:00', lunch_end = '13:00' where coach_id = $1", [coach]);
      await db.query("delete from public.bookings where coach_id = $1", [coach]);
      await db.query("insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1,$2,$3,$4,$5,'confirmed','unsettled')", [coach, bo, group, ...(await slot(0, 11))]);
      const lunch = await reasons(ann, [await slot(0, 12), await slot(0, 13), await slot(0, 10)]);
      h.check("the lunch break is never offered, even right after a session (the next free time after lunch is)", JSON.stringify(lunch.rows?.[0]?.r) === JSON.stringify(["lunch", null, null]), JSON.stringify(lunch));
      const lunchBook = await book(ann, await slot(0, 12));
      h.check("a client cannot book the lunch break", /lunch break/.test(lunchBook.error ?? ""), JSON.stringify(lunchBook));
      await db.query("update public.coach_booking_policies set keep_together = false, lunch_start = null, lunch_end = null where coach_id = $1", [coach]);

      // ---- caps
      await db.query("delete from public.bookings where coach_id = $1", [coach]);
      await db.query("update public.coach_booking_policies set max_sessions_per_week = 2 where coach_id = $1", [coach]);
      const a1 = await book(ann, await slot(0, 8));
      const a2 = await book(ann, await slot(1, 8));
      h.check("under the weekly cap a client books", !a1.error && !a2.error, JSON.stringify([a1, a2]));
      const a3 = await book(ann, await slot(1, 10));
      h.check("at the weekly cap a client is refused", /fully booked that week/.test(a3.error ?? ""), JSON.stringify(a3));
      const capReasons = await reasons(ann, [await slot(1, 15)]);
      h.check("...and the screens are told so", JSON.stringify(capReasons.rows?.[0]?.r) === JSON.stringify(["week_full"]), JSON.stringify(capReasons));
      // a client's own move within the same week is not refused by the cap (the session being moved is not counted twice)
      await h.as(ann);
      const mine = (await h.one("select id from public.bookings where athlete_id = $1 and coach_id = $2 order by start_at limit 1", [ann, coach])).id;
      const [ms, me] = await slot(0, 14);
      const move = await tryQ(db, "select public.reschedule_booking($1, $2::timestamptz, $3::timestamptz)", [mine, ms, me]);
      h.check("a client can move a session inside a full week", !move.error, JSON.stringify(move));
      // the coach books past the cap
      await h.as(coach);
      const [cs, ce] = await slot(1, 15);
      const coachBook = await tryQ(db, "select public.book_session($1, $2, $3, $4::timestamptz, $5::timestamptz) as id", [coach, bo, group, cs, ce]);
      h.check("the coach can still book past the cap", !coachBook.error, JSON.stringify(coachBook));
      await h.asSuper();
      // the monthly cap, and a request is refused by a cap too
      await db.query("update public.coach_booking_policies set max_sessions_per_week = null, max_sessions_per_month = 3, booking_mode = 'request' where coach_id = $1", [coach]);
      await h.as(ann);
      const req = await tryQ(db, "select public.request_booking($1, $2, $3, $4::timestamptz, $5::timestamptz)", [coach, ann, group, ...(await slot(2, 9))]);
      await h.asSuper();
      const sameMonth = (await h.one("select date_trunc('month', $1::date) = date_trunc('month', $1::date + 2) as same", [wed])).same;
      if (sameMonth) h.check("at the monthly cap a request is refused too", /fully booked that month/.test(req.error ?? ""), JSON.stringify(req));
      else h.check("(the month changed between the days; the monthly request check is skipped this run)", true);

      // ---- the coach's own count (the "25 of 25 this week" line): every confirmed one-on-one session of theirs in the range
      await h.as(coach);
      const mine2 = (await h.one("select public.my_session_count(now() - interval '400 days', now() + interval '400 days') as n")).n;
      await h.asSuper();
      const truth = (await h.one("select count(*)::int as n from public.bookings where coach_id = $1 and status = 'confirmed'", [coach])).n;
      h.check("the coach's own count matches their confirmed sessions", mine2 === truth && truth > 0, `${mine2} vs ${truth}`);
      await h.as(stranger);
      h.check("anyone else asking gets their own count (none), never the coach's", (await h.one("select public.my_session_count(now() - interval '400 days', now() + interval '400 days') as n")).n === 0);
      await h.asSuper();

      // ---- who may ask
      await h.as(stranger);
      const nope = await tryQ(db, "select public.client_slot_reasons($1, $2::timestamptz[], $3::timestamptz[]) as r", [coach, [cs], [ce]]);
      h.check("someone who does not train with the coach cannot ask", /not authorized/.test(nope.error ?? ""), JSON.stringify(nope));
      await h.asSuper();
      const acl = await h.one(
        "select has_function_privilege('authenticated', 'public.client_slot_reason(uuid, timestamptz, timestamptz, uuid, boolean)', 'execute') as reason_a, has_function_privilege('anon', 'public.client_slot_reasons(uuid, timestamptz[], timestamptz[], uuid)', 'execute') as reasons_anon"
      );
      h.check("the reason function is server only; signed-out visitors cannot ask", acl.reason_a === false && acl.reasons_anon === false, JSON.stringify(acl));
      await h.expectError("a cap must be 1 to 500", () => db.query("update public.coach_booking_policies set max_sessions_per_week = 0 where coach_id = $1", [coach]), /coach_booking_policies_caps_ok/);
      await h.expectError("a lunch break must end after it starts", () => db.query("update public.coach_booking_policies set lunch_start = '13:00', lunch_end = '12:00' where coach_id = $1", [coach]), /coach_booking_policies_lunch_ok/);
    },
  },
};
