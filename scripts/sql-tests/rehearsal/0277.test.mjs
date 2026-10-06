// 0277: a client's cancel or move INSIDE the coach's window is flagged for the coach to Charge or Waive; nothing is taken automatically. Before 0277 the
// database took the session itself (the gap on the live schema today), and this proves that, then the new behaviour, the coach's decision, and
// that cancels in time and cancels by the coach are unchanged.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const at = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();

async function setup(db, h, label) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const other = await h.user(`${label} Other Coach`);
  const org = await h.org(coach);
  const group = await h.group(org, coach, "one_on_one", `${label} group`);
  await h.member(group, ann);
  await h.asSuper();
  await db_insertPolicy(db, coach);
  await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5)`, [ann, group]);
  return { coach, ann, other, org, group };
}
async function db_insertPolicy(db, coach) {
  await db.query(`insert into public.coach_booking_policies (coach_id, cancellation_window_hours) values ($1, 24) on conflict (coach_id) do update set cancellation_window_hours = 24`, [coach]);
}
const booking = async (db, s, startHours, state) =>
  (await db.query(
    `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1, $2, $3, $4, $5, 'confirmed', $6) returning id`,
    [s.coach, s.ann, s.group, at(0, startHours), at(0, startHours + 1), state]
  )).rows[0].id;
const balance = async (h, s) => (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [s.ann, s.group])).balance;

export default {
  name: "0277 late cancel or move is flagged for the coach, not charged",
  migrations: ["0277"],
  phases: {
    // Right before 0277 applies: the state the live database is in.
    async "0276"({ db, h, state }) {
      const s = await setup(db, h, "L0");
      const unsettled = await booking(db, s, 3, "unsettled");
      await h.as(s.ann);
      const c1 = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [unsettled]);
      await h.asSuper();
      const b1 = await balance(h, s);
      h.check("baseline: a late cancel of a coach-scheduled session takes a session by itself (the gap 0277 closes)", !c1.error && b1 === 4, JSON.stringify({ c1, b1 }));
      const moving = await booking(db, s, 3, "unsettled");
      await h.as(s.ann);
      const m1 = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [moving, at(5), at(5, 1)]);
      await h.asSuper();
      const b2 = await balance(h, s);
      h.check("baseline: a late move takes one more session by itself", !m1.error && b2 === 3, JSON.stringify({ m1, b2 }));
    },

    async "0277"({ db, h, state }) {
      const s = await setup(db, h, "L1");
      // (a) a coach-scheduled (unsettled) session cancelled by the client inside the window
      const a = await booking(db, s, 3, "unsettled");
      await h.as(s.ann);
      const ca = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [a]);
      await h.asSuper();
      let row = await h.one(`select status, late_cancel, late_change_kind, late_charge_state from public.bookings where id = $1`, [a]);
      h.check("a late client cancel is flagged (cancelled, late_cancel, kind cancel, state flagged)", !ca.error && row.status === "cancelled" && row.late_cancel === true && row.late_change_kind === "cancel" && row.late_charge_state === "flagged", JSON.stringify({ ca, row }));
      h.check("and no session is taken automatically", (await balance(h, s)) === 5, String(await balance(h, s)));
      const notes = await h.rows(`select type, body, link_path from public.notifications where profile_id = $1`, [s.coach]);
      h.check("the coach is told in the notification list, naming the client and the window", notes.length === 1 && notes[0].type === "late_change" && /L1 Ann cancelled a session inside the 24-hour window/.test(notes[0].body), JSON.stringify(notes));

      // (b) a session already paid for (prepaid) cancelled late: the credit is given back, flagged
      await db.query(`update public.session_credits set balance = 4 where athlete_id = $1 and group_id = $2`, [s.ann, s.group]);
      const b = await booking(db, s, 4, "prepaid");
      await h.as(s.ann);
      const cb = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [b]);
      await h.asSuper();
      row = await h.one(`select late_charge_state from public.bookings where id = $1`, [b]);
      h.check("a late cancel of a paid session gives the credit back and flags it", !cb.error && (await balance(h, s)) === 5 && row.late_charge_state === "flagged", JSON.stringify({ cb, bal: await balance(h, s), row }));

      // (c) a cancel in time is unchanged: prepaid refunded, no flag, no notice
      await db.query(`update public.session_credits set balance = 4 where athlete_id = $1 and group_id = $2`, [s.ann, s.group]);
      const c = await booking(db, s, 72, "prepaid");
      await h.as(s.ann);
      const cc = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [c]);
      await h.asSuper();
      row = await h.one(`select late_cancel, late_charge_state from public.bookings where id = $1`, [c]);
      h.check("a cancel in time is unchanged: refunded, not flagged", !cc.error && (await balance(h, s)) === 5 && row.late_cancel === false && row.late_charge_state === null, JSON.stringify({ cc, row }));

      // (d) the coach cancelling inside the window is never flagged
      const d = await booking(db, s, 2, "unsettled");
      await h.as(s.coach);
      const cd = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [d]);
      await h.asSuper();
      row = await h.one(`select late_charge_state from public.bookings where id = $1`, [d]);
      h.check("a coach cancelling inside the window is not flagged", !cd.error && row.late_charge_state === null, JSON.stringify({ cd, row }));

      // (e) a late move is flagged and takes nothing
      const e = await booking(db, s, 3, "unsettled");
      await h.as(s.ann);
      const me = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [e, at(5), at(5, 1)]);
      await h.asSuper();
      row = await h.one(`select late_change_kind, late_charge_state, status from public.bookings where id = $1`, [e]);
      h.check("a late move is flagged (kind reschedule) and takes no session", !me.error && row.late_change_kind === "reschedule" && row.late_charge_state === "flagged" && row.status === "confirmed" && (await balance(h, s)) === 5, JSON.stringify({ me, row, bal: await balance(h, s) }));

      // (f) the coach's decision
      await h.as(s.ann);
      const byClient = await tryQ(db, `select public.resolve_late_change($1, true)`, [a]);
      await h.as(s.other);
      const byOther = await tryQ(db, `select public.resolve_late_change($1, true)`, [a]);
      await h.asSuper();
      h.check("a client and an unrelated coach cannot decide it", !!byClient.error && !!byOther.error && (await balance(h, s)) === 5, JSON.stringify({ byClient, byOther }));
      await h.as(s.coach);
      const charged = await tryQ(db, `select public.resolve_late_change($1, true)`, [a]);
      const again = await tryQ(db, `select public.resolve_late_change($1, true)`, [a]);
      const waived = await tryQ(db, `select public.resolve_late_change($1, false)`, [b]);
      const wrongState = await tryQ(db, `select public.resolve_late_change($1, true)`, [c]);
      await h.asSuper();
      row = await h.one(`select late_charge_state from public.bookings where id = $1`, [a]);
      const rowB = await h.one(`select late_charge_state from public.bookings where id = $1`, [b]);
      h.check("Charge takes one session once and marks it charged; asking again is refused", !charged.error && row.late_charge_state === "charged" && !!again.error && (await balance(h, s)) === 4, JSON.stringify({ charged, again, row, bal: await balance(h, s) }));
      h.check("Waive marks it waived and takes nothing", !waived.error && rowB.late_charge_state === "waived" && (await balance(h, s)) === 4, JSON.stringify({ waived, rowB }));
      h.check("a change that was never flagged cannot be charged", !!wrongState.error, JSON.stringify(wrongState));
      const ledger = await h.rows(`select amount, kind, note from public.session_credit_ledger where athlete_id = $1 and booking_id = $2`, [s.ann, a]);
      h.check("the charge is in the session ledger with a plain note", ledger.some((l) => l.amount === -1 && /charged by your coach/.test(l.note ?? "")), JSON.stringify(ledger));

      // (f2) a session the coach already waived is not flagged when the client cancels it late
      const w = await booking(db, s, 3, "waived");
      await h.as(s.ann);
      const cw = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [w]);
      await h.asSuper();
      row = await h.one(`select status, late_charge_state from public.bookings where id = $1`, [w]);
      const wNotes = await h.rows(`select count(*)::int as n from public.notifications where profile_id = $1 and type = 'late_change'`, [s.coach]);
      h.check("a late cancel of a session the coach already waived is not flagged and sends no notice", !cw.error && row.status === "cancelled" && row.late_charge_state === null && wNotes[0].n === 3, JSON.stringify({ cw, row, wNotes }));

      // (f3) the audit log watches the new column; the carriage-return-insensitive md5 used by the paste guards matches
      const trg = await h.one(`select pg_get_triggerdef(oid) as d from pg_trigger where tgname = 'bookings_audit'`);
      h.check("bookings_audit now watches late_charge_state as well as credit_state", /late_charge_state/.test(trg.d) && /credit_state/.test(trg.d), trg.d);
      const crlf = await h.one(`select md5(replace('a' || chr(13) || chr(10) || 'b', chr(13), '')) = md5('a' || chr(10) || 'b') as same`);
      h.check("the paste guards compare the function text with carriage returns removed, so live Windows line endings do not matter", crlf.same === true, JSON.stringify(crlf));

      // (g) the new function is not open to the public or the signed-out role
      const anon = await h.one(`select has_function_privilege('anon', 'public.resolve_late_change(uuid, boolean)', 'execute') as a, has_function_privilege('authenticated', 'public.resolve_late_change(uuid, boolean)', 'execute') as u`);
      h.check("resolve_late_change is closed to the signed-out role and open to signed-in users", anon.a === false && anon.u === true, JSON.stringify(anon));
    },
  },
};
