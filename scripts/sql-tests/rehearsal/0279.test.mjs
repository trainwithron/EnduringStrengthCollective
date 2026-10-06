// 0279: with self-booking off a client asks to move a session and the coach confirms; the session stays put until then. With it on a client moves
// directly. Proves the baseline (a client can move directly today), the refusal, the request, the coach's confirm and decline, the late-change rule on
// a confirmed move, and the checks (hours, taken slot, one pending request, who may decide).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
// A UTC wall-clock time on a given day offset: 18:00 UTC is 13:00 or 14:00 in New York (the default coach zone), inside 08:00 to 20:00.
const day = (days, hourUtc = 18) => {
  const d = new Date(Date.now() + days * 86400000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};
const plus = (iso, hours) => new Date(new Date(iso).getTime() + hours * 3600000).toISOString();
const soon = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

async function setup(db, h, label, selfBooking) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const bob = await h.user(`${label} Bob`);
  const other = await h.user(`${label} Other Coach`);
  const org = await h.org(coach);
  const group = await h.group(org, coach, "team", `${label} group`);
  await h.member(group, ann);
  await h.member(group, bob);
  await h.asSuper();
  await db.query(`insert into public.coach_booking_policies (coach_id, cancellation_window_hours, self_booking_enabled) values ($1, 24, $2) on conflict (coach_id) do update set cancellation_window_hours = 24, self_booking_enabled = $2`, [coach, selfBooking]);
  for (let wd = 0; wd <= 6; wd++) {
    await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes) values ($1, $2, '08:00', '20:00', 60)`, [coach, wd]);
  }
  await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5), ($3, $2, 5)`, [ann, group, bob]);
  return { coach, ann, bob, other, group };
}
const booking = async (db, s, athlete, startIso) =>
  (await db.query(
    `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1, $2, $3, $4, $5, 'confirmed', 'unsettled') returning id`,
    [s.coach, athlete, s.group, startIso, plus(startIso, 1)]
  )).rows[0].id;

export default {
  name: "0279 a client asks to move a session and the coach confirms",
  migrations: ["0279"],
  phases: {
    async "0278"({ db, h }) {
      const s = await setup(db, h, "M0", false);
      const b = await booking(db, s, s.ann, day(6));
      await h.as(s.ann);
      const moved = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [b, day(7), plus(day(7), 1)]);
      await h.asSuper();
      h.check("baseline: today a client can move their own session directly, even with self-booking off (what 0279 changes)", !moved.error, JSON.stringify(moved));
    },

    async "0279"({ db, h }) {
      const s = await setup(db, h, "M1", false);
      const b = await booking(db, s, s.ann, day(6));
      const newStart = day(7);
      const newEnd = plus(newStart, 1);

      // direct move refused while self-booking is off
      await h.as(s.ann);
      const direct = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [b, newStart, newEnd]);
      await h.asSuper();
      h.check("with self-booking off a client cannot move a session directly", /your coach confirms moves/.test(direct.error ?? ""), JSON.stringify(direct));

      // the request
      await h.as(s.ann);
      const req = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [b, newStart, newEnd]);
      await h.asSuper();
      const reqId = req.rows?.[0]?.id;
      const bk = await h.one(`select start_at from public.bookings where id = $1`, [b]);
      h.check("the client can ask, and the session stays at its original time", !!reqId && new Date(bk.start_at).toISOString() === day(6), JSON.stringify({ req, bk }));
      let notes = await h.rows(`select type, body, link_path from public.notifications where profile_id = $1 and type = 'move_request'`, [s.coach]);
      h.check("the coach is told, naming the client and both times", notes.length === 1 && /M1 Ann asked to move their/.test(notes[0].body) && /Confirm or decline/.test(notes[0].body), JSON.stringify(notes));

      // checks on the request
      await h.as(s.ann);
      const again = await tryQ(db, `select public.request_booking_move($1, $2, $3)`, [b, day(8), plus(day(8), 1)]);
      const outside = await tryQ(db, `select public.request_booking_move($1, $2, $3)`, [await (async () => { await h.asSuper(); const x = await booking(db, s, s.ann, day(9)); await h.as(s.ann); return x; })(), day(10, 4), plus(day(10, 4), 1)]);
      await h.as(s.bob);
      const notMine = await tryQ(db, `select public.request_booking_move($1, $2, $3)`, [b, day(8), plus(day(8), 1)]);
      await h.asSuper();
      h.check("only one request can wait at a time for a session", /already asked/.test(again.error ?? ""), JSON.stringify(again));
      h.check("a time outside the coach's weekly hours is refused", /outside your coach/.test(outside.error ?? ""), JSON.stringify(outside));
      h.check("another client cannot ask to move someone else's session", !!notMine.error, JSON.stringify(notMine));
      const taken = await booking(db, s, s.bob, day(11));
      await h.as(s.ann);
      const b2 = await (async () => { await h.asSuper(); const x = await booking(db, s, s.ann, day(12)); await h.as(s.ann); return x; })();
      const slotTaken = await tryQ(db, `select public.request_booking_move($1, $2, $3)`, [b2, day(11), plus(day(11), 1)]);
      await h.asSuper();
      h.check("a time that is already taken is refused", /just taken/.test(slotTaken.error ?? "") && !!taken, JSON.stringify(slotTaken));

      // who may decide
      await h.as(s.ann);
      const byClient = await tryQ(db, `select public.resolve_move_request($1, true)`, [reqId]);
      await h.as(s.other);
      const byOther = await tryQ(db, `select public.resolve_move_request($1, true)`, [reqId]);
      await h.asSuper();
      h.check("neither the client nor an unrelated coach can decide it", !!byClient.error && !!byOther.error, JSON.stringify({ byClient, byOther }));

      // confirm
      await h.as(s.coach);
      const ok = await tryQ(db, `select public.resolve_move_request($1, true) as r`, [reqId]);
      const twice = await tryQ(db, `select public.resolve_move_request($1, true)`, [reqId]);
      await h.asSuper();
      const moved = await h.one(`select start_at, late_charge_state from public.bookings where id = $1`, [b]);
      const reqRow = await h.one(`select status from public.booking_move_requests where id = $1`, [reqId]);
      h.check("the coach confirms: the session moves, the request closes, and a second answer is refused", ok.rows?.[0]?.r === "confirmed" && new Date(moved.start_at).toISOString() === newStart && reqRow.status === "confirmed" && !!twice.error, JSON.stringify({ ok, moved, reqRow, twice }));
      h.check("a move asked for well outside the window is not flagged", moved.late_charge_state === null, JSON.stringify(moved));
      notes = await h.rows(`select body from public.notifications where profile_id = $1 and type = 'move_decision'`, [s.ann]);
      h.check("the client is told their new time", notes.length === 1 && /confirmed your new time/.test(notes[0].body), JSON.stringify(notes));

      // decline
      const b3 = await booking(db, s, s.ann, day(13));
      await h.as(s.ann);
      const r3 = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [b3, day(14), plus(day(14), 1)]);
      await h.as(s.coach);
      const dec = await tryQ(db, `select public.resolve_move_request($1, false) as r`, [r3.rows?.[0]?.id]);
      await h.asSuper();
      const kept = await h.one(`select start_at from public.bookings where id = $1`, [b3]);
      notes = await h.rows(`select body from public.notifications where profile_id = $1 and type = 'move_decision' order by created_at desc limit 1`, [s.ann]);
      h.check("declining leaves the session where it was and tells the client", dec.rows?.[0]?.r === "declined" && new Date(kept.start_at).toISOString() === day(13) && /kept your session/.test(notes[0]?.body ?? ""), JSON.stringify({ dec, kept, notes }));

      // late rule on a confirmed move
      const late = await booking(db, s, s.ann, soon(3));
      await h.as(s.ann);
      const r4 = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [late, day(15), plus(day(15), 1)]);
      await h.as(s.coach);
      const c4 = await tryQ(db, `select public.resolve_move_request($1, true) as r`, [r4.rows?.[0]?.id]);
      await h.asSuper();
      const lateRow = await h.one(`select late_change_kind, late_charge_state from public.bookings where id = $1`, [late]);
      h.check("a move confirmed for a session that was inside the window is flagged for Charge or Waive, like a direct late move", c4.rows?.[0]?.r === "confirmed" && lateRow.late_charge_state === "flagged" && lateRow.late_change_kind === "reschedule", JSON.stringify({ c4, lateRow }));

      // a cancelled session closes the request
      const b5 = await booking(db, s, s.ann, day(16));
      await h.as(s.ann);
      const r5 = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [b5, day(17), plus(day(17), 1)]);
      await h.as(s.coach);
      await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [b5]);
      const c5 = await tryQ(db, `select public.resolve_move_request($1, true) as r`, [r5.rows?.[0]?.id]);
      await h.asSuper();
      const r5row = await h.one(`select status from public.booking_move_requests where id = $1`, [r5.rows?.[0]?.id]);
      h.check("if the session was cancelled meanwhile, the request just closes", c5.rows?.[0]?.r === "closed" && r5row.status === "cancelled", JSON.stringify({ c5, r5row }));

      // row security: the client and the coach can read requests, a stranger cannot, and nobody can write directly
      await h.as(s.other);
      const strangers = await tryQ(db, `select count(*)::int as n from public.booking_move_requests`);
      await h.as(s.ann);
      const forged = await tryQ(db, `insert into public.booking_move_requests (booking_id, athlete_id, coach_id, group_id, from_start_at, new_start_at, new_end_at) values ($1, $2, $3, $4, now(), now(), now() + interval '1 hour')`, [b, s.ann, s.coach, s.group]);
      await h.asSuper();
      h.check("an unrelated coach sees no requests and a client cannot write one directly", strangers.rows?.[0]?.n === 0 && !!forged.error, JSON.stringify({ strangers, forged }));
      const anon = await h.one(`select has_function_privilege('anon', 'public.request_booking_move(uuid, timestamptz, timestamptz)', 'execute') as a, has_function_privilege('anon', 'public.resolve_move_request(uuid, boolean)', 'execute') as b`);
      h.check("both functions are closed to the signed-out role", anon.a === false && anon.b === false, JSON.stringify(anon));

      // with self-booking ON the client moves directly again
      await h.asSuper();
      await db.query(`update public.coach_booking_policies set self_booking_enabled = true where coach_id = $1`, [s.coach]);
      const b6 = await booking(db, s, s.ann, day(18));
      await h.as(s.ann);
      const onMove = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [b6, day(19), plus(day(19), 1)]);
      await h.asSuper();
      h.check("with self-booking on, a client moves directly as before", !onMove.error, JSON.stringify(onMove));
    },
  },
};
