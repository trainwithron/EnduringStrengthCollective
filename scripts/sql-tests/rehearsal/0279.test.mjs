// 0279: in 'request' mode a client asks for a new session or asks to move one, and the coach confirms. One mechanism for both: pending, confirmed,
// declined, expired, cancelled. No slot is held while a request is pending. Proves the checks (mode, hours, time off, notice, taken slot, cap), the
// coach's decisions, the late-change rule on a confirmed move, expiry, withdrawal, and who may do what.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
// 18:00 UTC is 13:00 or 14:00 in New York (the default coach zone): inside 08:00 to 20:00.
const day = (days, hourUtc = 18) => {
  const d = new Date(Date.now() + days * 86400000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};
const plus = (iso, hours) => new Date(new Date(iso).getTime() + hours * 3600000).toISOString();
const soon = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

async function setup(db, h, label, mode) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const bob = await h.user(`${label} Bob`);
  const other = await h.user(`${label} Other Coach`);
  const org = await h.org(coach);
  const group = await h.group(org, coach, "team", `${label} group`);
  await h.member(group, ann);
  await h.member(group, bob);
  await h.asSuper();
  await db.query(`update public.profiles set timezone = 'America/New_York' where id = $1`, [coach]);
  await db.query(`insert into public.coach_booking_policies (coach_id, cancellation_window_hours, booking_mode) values ($1, 24, $2) on conflict (coach_id) do update set cancellation_window_hours = 24, booking_mode = $2`, [coach, mode]);
  for (let wd = 0; wd <= 6; wd++) {
    await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, slot_duration_minutes) values ($1, $2, '08:00', '20:00', 60)`, [coach, wd]);
  }
  await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5), ($3, $2, 5)`, [ann, group, bob]);
  return { coach, ann, bob, other, group };
}
const booking = async (db, s, athlete, startIso, state = "unsettled") =>
  (await db.query(
    `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1, $2, $3, $4, $5, 'confirmed', $6) returning id`,
    [s.coach, athlete, s.group, startIso, plus(startIso, 1), state]
  )).rows[0].id;
const ask = (db, s, who, startIso) => tryQ(db, `select public.request_booking($1, $2, $3, $4, $5) as id`, [s.coach, who, s.group, startIso, plus(startIso, 1)]);

export default {
  name: "0279 booking requests (new and move) confirmed by the coach",
  migrations: ["0279"],
  phases: {
    async "0278"({ db, h }) {
      const s = await setup(db, h, "R0", "free");
      const b = await booking(db, s, s.ann, day(6));
      await h.as(s.ann);
      const moved = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [b, day(7), plus(day(7), 1)]);
      await h.asSuper();
      h.check("baseline: a client can move their own session directly (in free mode it must stay that way)", !moved.error, JSON.stringify(moved));
    },

    async "0279"({ db, h }) {
      // ---- direct moves follow the mode
      const sFree = await setup(db, h, "R1", "free");
      const bFree = await booking(db, sFree, sFree.ann, day(6));
      await h.as(sFree.ann);
      const movedFree = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [bFree, day(7), plus(day(7), 1)]);
      await h.asSuper();
      h.check("free mode: a client moves directly as before", !movedFree.error, JSON.stringify(movedFree));
      const sSched = await setup(db, h, "R2", "coach_schedules");
      const bSched = await booking(db, sSched, sSched.ann, day(6));
      await h.as(sSched.ann);
      const movedSched = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [bSched, day(7), plus(day(7), 1)]);
      const askSched = await ask(db, sSched, sSched.ann, day(8));
      await h.asSuper();
      h.check("coach-schedules mode: a client can neither move nor ask", /schedules your sessions/.test(movedSched.error ?? "") && /schedules your sessions/.test(askSched.error ?? ""), JSON.stringify({ movedSched, askSched }));

      const s = await setup(db, h, "R3", "request");
      const b = await booking(db, s, s.ann, day(6));
      await h.as(s.ann);
      const directReq = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [b, day(7), plus(day(7), 1)]);
      await h.asSuper();
      h.check("request mode: a direct move is refused ('ask for the new time')", /confirms moves/.test(directReq.error ?? ""), JSON.stringify(directReq));
      await h.as(sFree.ann);
      const askFree = await ask(db, sFree, sFree.ann, day(9));
      await h.asSuper();
      h.check("free mode: asking is refused ('you can book this directly')", /book this directly/.test(askFree.error ?? ""), JSON.stringify(askFree));

      // a coach with no time zone set is refused with a plain message
      const sNoTz = await setup(db, h, "R3b", "request");
      await db.query(`update public.profiles set timezone = null where id = $1`, [sNoTz.coach]);
      await h.as(sNoTz.ann);
      const noTz = await ask(db, sNoTz, sNoTz.ann, day(10));
      await h.asSuper();
      h.check("a request to a coach who has not set a time zone is refused in plain words", /has not set a time zone/.test(noTz.error ?? ""), JSON.stringify(noTz));

      // ---- a NEW request
      await h.as(s.ann);
      const t1 = day(10);
      const r1 = await ask(db, s, s.ann, t1);
      await h.asSuper();
      const reqId = r1.rows?.[0]?.id;
      const none = await h.one(`select count(*)::int as n from public.bookings where athlete_id = $1 and start_at = $2`, [s.ann, t1]);
      h.check("a request is saved as pending and nothing is booked", !!reqId && none.n === 0, JSON.stringify({ r1, none }));
      let notes = await h.rows(`select body from public.notifications where profile_id = $1 and type = 'booking_request'`, [s.coach]);
      h.check("the coach is told", notes.length === 1 && /R3 Ann asked for a session on/.test(notes[0].body), JSON.stringify(notes));

      await h.as(s.ann);
      const dup = await ask(db, s, s.ann, t1);
      const outside = await ask(db, s, s.ann, day(11, 4));
      const past = await ask(db, s, s.ann, soon(-5));
      await h.asSuper();
      h.check("the same time twice is refused", /already asked for that time/.test(dup.error ?? ""), JSON.stringify(dup));
      h.check("a time outside the coach's hours is refused", /outside your coach/.test(outside.error ?? ""), JSON.stringify(outside));
      h.check("a time that has passed is refused", !!past.error, JSON.stringify(past));
      await db.query(`insert into public.coach_availability_exceptions (coach_id, kind, label, start_at, end_at) values ($1, 'one_off', 'Off', $2, $3)`, [s.coach, day(12, 12), day(12, 23)]);
      await h.as(s.ann);
      const timeOff = await ask(db, s, s.ann, day(12));
      await h.asSuper();
      h.check("a time the coach has blocked off is refused", /outside your coach/.test(timeOff.error ?? ""), JSON.stringify(timeOff));
      await h.as(s.ann);
      const second = await ask(db, s, s.ann, day(13));
      const third = await ask(db, s, s.ann, day(14));
      const fourth = await ask(db, s, s.ann, day(15));
      await h.asSuper();
      h.check("a client can have at most 3 requests waiting", !second.error && !third.error && /3 requests/.test(fourth.error ?? ""), JSON.stringify({ second, third, fourth }));

      // no slot is held: another client can ask for the same time; the first confirm wins, the second is declined for the coach and told
      await h.as(s.bob);
      const bobAsk = await ask(db, s, s.bob, t1);
      await h.asSuper();
      const bobReq = bobAsk.rows?.[0]?.id;
      h.check("nothing is held while a request waits: another client can ask for the same time", !bobAsk.error && !!bobReq, JSON.stringify(bobAsk));
      await h.as(s.ann);
      const byClient = await tryQ(db, `select public.resolve_booking_request($1, true)`, [reqId]);
      await h.as(s.other);
      const byOther = await tryQ(db, `select public.resolve_booking_request($1, true)`, [reqId]);
      await h.asSuper();
      h.check("neither the client nor an unrelated coach can decide", !!byClient.error && !!byOther.error, JSON.stringify({ byClient, byOther }));
      await h.as(s.coach);
      const ok = await tryQ(db, `select public.resolve_booking_request($1, true) as r`, [reqId]);
      const second2 = await tryQ(db, `select public.resolve_booking_request($1, true) as r`, [bobReq]);
      const again = await tryQ(db, `select public.resolve_booking_request($1, true)`, [reqId]);
      await h.asSuper();
      const made = await h.one(`select status, credit_state from public.bookings where athlete_id = $1 and start_at = $2`, [s.ann, t1]);
      const bobRow = await h.one(`select status from public.booking_requests where id = $1`, [bobReq]);
      h.check("Confirm books the session (unsettled, like a coach-scheduled one); a second answer is refused", ok.rows?.[0]?.r === "confirmed" && made.status === "confirmed" && made.credit_state === "unsettled" && !!again.error, JSON.stringify({ ok, made, again }));
      h.check("the second client's request for the same time is declined for the coach and the client told", second2.rows?.[0]?.r === "slot_taken" && bobRow.status === "declined", JSON.stringify({ second2, bobRow }));
      notes = await h.rows(`select body from public.notifications where profile_id = $1 and type = 'request_decision' order by created_at`, [s.bob]);
      h.check("and says the time was taken", notes.length === 1 && /was taken before your coach could confirm/.test(notes[0].body), JSON.stringify(notes));
      notes = await h.rows(`select body from public.notifications where profile_id = $1 and type = 'request_decision'`, [s.ann]);
      h.check("the confirmed client is told", notes.length === 1 && /confirmed your session/.test(notes[0].body), JSON.stringify(notes));

      // decline a new request
      await h.as(s.ann);
      const rd = await ask(db, s, s.ann, day(16));
      await h.as(s.coach);
      const dec = await tryQ(db, `select public.resolve_booking_request($1, false) as r`, [rd.rows?.[0]?.id]);
      await h.asSuper();
      h.check("Decline books nothing and the client is told", dec.rows?.[0]?.r === "declined" && (await h.one(`select count(*)::int as n from public.bookings where athlete_id = $1 and start_at = $2`, [s.ann, day(16)])).n === 0, JSON.stringify(dec));

      // withdraw
      await h.as(s.ann);
      const rw = await ask(db, s, s.ann, day(17));
      await h.as(s.bob);
      const wrong = await tryQ(db, `select public.cancel_booking_request($1)`, [rw.rows?.[0]?.id]);
      await h.as(s.ann);
      const withdrawn = await tryQ(db, `select public.cancel_booking_request($1)`, [rw.rows?.[0]?.id]);
      await h.asSuper();
      h.check("a client can withdraw their own pending request and nobody else can", !!wrong.error && !withdrawn.error && (await h.one(`select status from public.booking_requests where id = $1`, [rw.rows?.[0]?.id])).status === "cancelled", JSON.stringify({ wrong, withdrawn }));

      // expiry (service role only)
      const exp = await booking(db, s, s.bob, day(40));
      await db.query(`insert into public.booking_requests (kind, athlete_id, coach_id, group_id, new_start_at, new_end_at, created_at) values ('new', $1, $2, $3, $4, $5, now() - interval '3 days')`, [s.bob, s.coach, s.group, soon(-2), soon(-1)]);
      await h.as(s.coach);
      const noExpire = await tryQ(db, `select public.expire_stale_booking_requests()`);
      await h.asService();
      const expired = await tryQ(db, `select public.expire_stale_booking_requests() as n`);
      await h.asSuper();
      h.check("only the server can expire stale requests, and a past request lapses with a notice", !!noExpire.error && expired.rows?.[0]?.n === 1 && !!exp && (await h.rows(`select body from public.notifications where profile_id = $1 and type = 'request_decision' and body like '%lapsed%'`, [s.bob])).length === 1, JSON.stringify({ noExpire, expired }));

      // ---- a MOVE request
      await h.asSuper();
      await db.query(`update public.booking_requests set status = 'cancelled' where athlete_id = $1 and status = 'pending'`, [s.ann]);
      await h.as(s.ann);
      const newStart = day(20);
      const rm = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [b, newStart, plus(newStart, 1)]);
      await h.asSuper();
      const moveId = rm.rows?.[0]?.id;
      const stay = await h.one(`select start_at from public.bookings where id = $1`, [b]);
      h.check("a move request leaves the session where it is", !!moveId && new Date(stay.start_at).toISOString() === day(6), JSON.stringify({ rm, stay }));
      await h.as(s.ann);
      const moveAgain = await tryQ(db, `select public.request_booking_move($1, $2, $3)`, [b, day(21), plus(day(21), 1)]);
      await h.asSuper();
      h.check("only one move request can wait for a session", /already asked to move/.test(moveAgain.error ?? ""), JSON.stringify(moveAgain));
      await h.as(s.coach);
      const mok = await tryQ(db, `select public.resolve_booking_request($1, true) as r`, [moveId]);
      await h.asSuper();
      const moved = await h.one(`select start_at, late_charge_state from public.bookings where id = $1`, [b]);
      h.check("Confirm moves the session and does not flag one asked for well outside the window", mok.rows?.[0]?.r === "confirmed" && new Date(moved.start_at).toISOString() === newStart && moved.late_charge_state === null, JSON.stringify({ mok, moved }));

      // late move: flagged
      const late = await booking(db, s, s.ann, soon(3));
      await h.as(s.ann);
      const rl = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [late, day(22), plus(day(22), 1)]);
      await h.as(s.coach);
      const lc = await tryQ(db, `select public.resolve_booking_request($1, true) as r`, [rl.rows?.[0]?.id]);
      await h.asSuper();
      const lateRow = await h.one(`select late_change_kind, late_charge_state from public.bookings where id = $1`, [late]);
      h.check("a confirmed move asked for inside the window is flagged for Charge or Waive", lc.rows?.[0]?.r === "confirmed" && lateRow.late_charge_state === "flagged" && lateRow.late_change_kind === "reschedule", JSON.stringify({ lc, lateRow }));

      // stale: the session moved by another route since the client asked
      const stale = await booking(db, s, s.ann, day(24));
      await h.as(s.ann);
      const rs = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [stale, day(25), plus(day(25), 1)]);
      await h.asSuper();
      await db.query(`update public.bookings set start_at = $2, end_at = $3 where id = $1`, [stale, day(26), plus(day(26), 1)]);
      await h.as(s.coach);
      const sc = await tryQ(db, `select public.resolve_booking_request($1, true) as r`, [rs.rows?.[0]?.id]);
      await h.asSuper();
      h.check("if the session was moved some other way since the client asked, the request just closes", sc.rows?.[0]?.r === "closed" && (await h.one(`select status from public.booking_requests where id = $1`, [rs.rows?.[0]?.id])).status === "cancelled", JSON.stringify(sc));

      // cancelled session closes the request
      const gone = await booking(db, s, s.ann, day(28));
      await h.as(s.ann);
      const rg = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [gone, day(29), plus(day(29), 1)]);
      await h.as(s.coach);
      await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [gone]);
      const gc = await tryQ(db, `select public.resolve_booking_request($1, true) as r`, [rg.rows?.[0]?.id]);
      await h.asSuper();
      h.check("if the session was cancelled meanwhile, the request just closes", gc.rows?.[0]?.r === "closed", JSON.stringify(gc));

      // a late move of a session the coach already waived is not flagged (direct or confirmed)
      const sF = await setup(db, h, "R4", "free");
      const waived = await booking(db, sF, sF.ann, soon(3), "waived");
      await h.as(sF.ann);
      await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [waived, day(5), plus(day(5), 1)]);
      await h.asSuper();
      h.check("a late direct move of a waived session is not flagged", (await h.one(`select late_charge_state from public.bookings where id = $1`, [waived])).late_charge_state === null, "");
      const waivedReq = await booking(db, s, s.ann, soon(3), "waived");
      await h.as(s.ann);
      const wr = await tryQ(db, `select public.request_booking_move($1, $2, $3) as id`, [waivedReq, day(30), plus(day(30), 1)]);
      await h.as(s.coach);
      await tryQ(db, `select public.resolve_booking_request($1, true)`, [wr.rows?.[0]?.id]);
      await h.asSuper();
      h.check("a confirmed late move of a waived session is not flagged either", (await h.one(`select late_charge_state from public.bookings where id = $1`, [waivedReq])).late_charge_state === null, "");

      // the client is told when a request closes because the session changed
      const closedNote = await h.rows(`select body from public.notifications where profile_id = $1 and type = 'request_decision' and body like '%session changed%'`, [s.ann]);
      h.check("a request that closes because the session changed tells the client", closedNote.length >= 1, JSON.stringify(closedNote));

      // row security and privileges
      await h.as(s.other);
      const strangers = await tryQ(db, `select count(*)::int as n from public.booking_requests`);
      await h.as(s.ann);
      const forged = await tryQ(db, `insert into public.booking_requests (kind, athlete_id, coach_id, group_id, new_start_at, new_end_at) values ('new', $1, $2, $3, now(), now() + interval '1 hour')`, [s.ann, s.coach, s.group]);
      await h.asSuper();
      h.check("an unrelated coach sees no requests and a client cannot write one directly", strangers.rows?.[0]?.n === 0 && !!forged.error, JSON.stringify({ strangers, forged }));
      const priv = await h.one(`select has_function_privilege('anon', 'public.request_booking(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute') as a, has_function_privilege('anon', 'public.resolve_booking_request(uuid, boolean)', 'execute') as b, has_function_privilege('authenticated', 'public.expire_stale_booking_requests()', 'execute') as c`);
      h.check("the request functions are closed to the signed-out role and expiry is server-only", priv.a === false && priv.b === false && priv.c === false, JSON.stringify(priv));
      const internal = await h.one(`select has_function_privilege('authenticated', 'public.coach_time_is_open(uuid, timestamptz, timestamptz)', 'execute') as a, has_function_privilege('authenticated', 'public.check_booking_request_slot(uuid, uuid, timestamptz, timestamptz)', 'execute') as b`);
      h.check("the two slot-check helpers are not executable by signed-in users (no probing another coach's availability)", internal.a === false && internal.b === false, JSON.stringify(internal));
    },
  },
};
