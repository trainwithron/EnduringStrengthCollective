// 0288: two bookings that overlap but start at different minutes can no longer both be saved (a per-coach lock plus a second overlap check before a confirmed
// future booking is saved or moved). History is never re-checked, cancelling is never refused, and nobody signed in can call the trigger function.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

const SQL_TIME = (hh, mm, plusDays) => `(date_trunc('day', now() at time zone 'UTC') + interval '${plusDays} days' + interval '${hh} hours ${mm} minutes') at time zone 'UTC'`;

export default {
  name: "0288 overlapping bookings guard (per-coach lock)",
  migrations: ["0288"],
  phases: {
    async "0287"({ db, h }) {
      const coach = await h.user("U1 Coach");
      const ann = await h.user("U1 Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "U1 group");
      await h.member(group, ann);
      await h.asSuper();
      const a = await tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status) values ($1, $2, $3, ${SQL_TIME(10, 0, 20)}, ${SQL_TIME(10, 55, 20)}, 'confirmed')`, [coach, ann, group]);
      const b = await tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status) values ($1, $2, $3, ${SQL_TIME(10, 15, 20)}, ${SQL_TIME(11, 10, 20)}, 'confirmed')`, [coach, ann, group]);
      h.check("baseline: before 0288 two overlapping bookings at different minutes can both be saved by a direct write (the gap 0288 closes)", !a.error && !b.error, JSON.stringify({ a, b }));
    },

    async "0288"({ db, h }) {
      const coach = await h.user("U2 Coach");
      const ann = await h.user("U2 Ann");
      const bob = await h.user("U2 Bob");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "U2 group");
      await h.member(group, ann);
      await h.member(group, bob);
      await h.asSuper();
      await db.query(`insert into public.coach_booking_policies (coach_id, buffer_minutes) values ($1, 5) on conflict (coach_id) do update set buffer_minutes = 5`, [coach]);
      const ins = (athlete, sh, sm, eh, em, day, status = "confirmed") =>
        tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status) values ($1, $2, $3, ${SQL_TIME(sh, sm, day)}, ${SQL_TIME(eh, em, day)}, '${status}') returning id`, [coach, athlete, group]);

      const first = await ins(ann, 10, 0, 10, 55, 30);
      const overlap = await ins(bob, 10, 15, 11, 10, 30);
      const tooClose = await ins(bob, 11, 0, 11, 55, 30); // 5 minute gap needed after 10:55: 11:00 is exactly 5 minutes, so it is allowed
      h.check("the first booking is saved", !first.error, JSON.stringify(first));
      h.check("an overlapping booking at a different minute (10:15 over 10:00 to 10:55) is refused with the usual message", /just taken/.test(overlap.error ?? ""), JSON.stringify(overlap));
      h.check("a booking exactly one gap (5 minutes) after the first ends is accepted", !tooClose.error, JSON.stringify(tooClose));
      h.check("a booking that starts less than the gap after one ends (11:58 after 11:55) is refused", /just taken/.test((await ins(bob, 11, 58, 12, 40, 30)).error ?? ""));

      // moving a booking into another is refused; moving it somewhere free is accepted
      const free = await ins(bob, 14, 0, 14, 55, 30);
      const moveInto = await tryQ(db, `update public.bookings set start_at = ${SQL_TIME(10, 20, 30)}, end_at = ${SQL_TIME(11, 15, 30)} where id = $1`, [free.rows?.[0]?.id]);
      const moveFree = await tryQ(db, `update public.bookings set start_at = ${SQL_TIME(15, 0, 30)}, end_at = ${SQL_TIME(15, 55, 30)} where id = $1`, [free.rows?.[0]?.id]);
      h.check("moving a booking into another session is refused", /just taken/.test(moveInto.error ?? ""), JSON.stringify(moveInto));
      h.check("moving it to a free time is accepted", !moveFree.error, JSON.stringify(moveFree));

      // cancelling is never refused, a cancelled booking blocks nothing, and re-confirming into a clash is refused
      const cancel = await tryQ(db, `update public.bookings set status = 'cancelled' where id = $1`, [first.rows?.[0]?.id]);
      const reuse = await ins(bob, 10, 0, 10, 55, 30);
      h.check("cancelling a booking is accepted, and its time is free again", !cancel.error && !reuse.error, JSON.stringify({ cancel, reuse }));
      const reconfirm = await tryQ(db, `update public.bookings set status = 'confirmed' where id = $1`, [first.rows?.[0]?.id]);
      h.check("putting a cancelled booking back on a time that has since been taken is refused", /just taken/.test(reconfirm.error ?? ""), JSON.stringify(reconfirm));

      // history is never re-checked: a session that already ended can overlap another record, and edits to other columns do not trigger the check
      const past1 = await ins(ann, 9, 0, 9, 55, -3);
      const past2 = await ins(bob, 9, 10, 10, 5, -3);
      h.check("sessions that have already ended are not checked (history can be recorded as it happened)", !past1.error && !past2.error, JSON.stringify({ past1, past2 }));
      const other = await tryQ(db, `update public.bookings set no_show = true where id = $1`, [past1.rows?.[0]?.id]);
      h.check("an edit to some other column of a past booking is accepted", !other.error, JSON.stringify(other));

      // the public discovery form is covered both ways
      const disc = await tryQ(db, `insert into public.discovery_bookings (coach_id, start_at, end_at, prospect_name, prospect_email, status) values ($1, ${SQL_TIME(10, 30, 30)}, ${SQL_TIME(11, 0, 30)}, 'P', 'p@example.com', 'confirmed')`, [coach]);
      h.check("a discovery call over a confirmed session is refused", /just taken/.test(disc.error ?? ""), JSON.stringify(disc));
      const disc2 = await tryQ(db, `insert into public.discovery_bookings (coach_id, start_at, end_at, prospect_name, prospect_email, status) values ($1, ${SQL_TIME(18, 0, 30)}, ${SQL_TIME(18, 30, 30)}, 'P', 'p2@example.com', 'confirmed') returning id`, [coach]);
      const overDisc = await ins(ann, 18, 15, 19, 10, 30);
      h.check("a free discovery call is accepted, and a session over it is refused", !disc2.error && /just taken/.test(overDisc.error ?? ""), JSON.stringify({ disc2, overDisc }));

      // the booking function still works end to end and gives the same message on a clash
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5) on conflict (athlete_id, group_id) do update set balance = 5`, [bob, group]);
      await h.as(coach);
      const viaFn = await tryQ(db, `select public.book_session($1, $2, $3, ${SQL_TIME(7, 0, 33)}, ${SQL_TIME(7, 55, 33)}) as id`, [coach, bob, group]);
      const viaFnClash = await tryQ(db, `select public.book_session($1, $2, $3, ${SQL_TIME(7, 20, 33)}, ${SQL_TIME(8, 15, 33)}) as id`, [coach, ann, group]);
      await h.asSuper();
      h.check("book_session still books, and an overlapping call is refused with its own message", !viaFn.error && /just taken/.test(viaFnClash.error ?? ""), JSON.stringify({ viaFn, viaFnClash }));

      // the function is a trigger only: it takes a per-coach lock, and nobody signed in or out can call it
      const src = await h.one(`select prosrc from pg_proc where proname = 'guard_booking_overlap'`);
      h.check("it takes a lock per coach before the second look", /pg_advisory_xact_lock\(hashtextextended\('booking:'/.test(src.prosrc), src.prosrc.slice(0, 80));
      const acl = await h.one(`select has_function_privilege('authenticated', 'public.guard_booking_overlap()', 'execute') as auth, has_function_privilege('anon', 'public.guard_booking_overlap()', 'execute') as anon`);
      h.check("nobody signed in or out can call it directly", acl.auth === false && acl.anon === false, JSON.stringify(acl));
    },
  },
};
