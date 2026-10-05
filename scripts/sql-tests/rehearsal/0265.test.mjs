// 0265: bookings are written through the booking functions, not directly by the client. The hole exists on the live database today; this
// proves it, proves the fix, and proves the legitimate paths (book, cancel, reschedule as a client; coach edits) still work afterwards.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const at = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();

export default {
  name: "0265 bookings: direct writes are coach-only, booking functions still work",
  migrations: ["0265"],
  phases: {
    async live({ db, h, state }) {
      const coach = await h.user("Book Coach");
      const ann = await h.user("Book Ann");
      const bo = await h.user("Book Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Book group");
      await h.member(group, ann);
      await h.member(group, bo);
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 3), ($3, $2, 3)`, [ann, group, bo]);
      Object.assign(state, { coach, ann, bo, group });
      await h.as(ann);
      const free = await tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at) values ($1, $2, $3, $4, $5) returning id`, [coach, ann, group, at(6), at(6, 1)]);
      await h.asSuper();
      const balAfter = (await h.one(`select balance from public.session_credits where athlete_id = $1`, [ann])).balance;
      h.check("baseline: on the live schema a client can insert a booking straight into the table, with no session taken (the hole 0265 closes)", !!free.rows && balAfter === 3, JSON.stringify({ free, balAfter }));
      await h.as(ann);
      const move = await tryQ(db, `update public.bookings set start_at = $2, end_at = $3 where id = $1 returning id`, [free.rows?.[0]?.id, at(1), at(1, 1)]);
      h.check("baseline: and can move their booking to any time with a direct update, skipping the reschedule rules", !!move.rows, JSON.stringify(move));
      await h.asSuper();
      await db.query(`delete from public.bookings where athlete_id = $1`, [ann]);
    },

    async "0265"({ db, h, state }) {
      const { coach, ann, bo, group } = state;
      await h.asSuper();
      await db.query(`update public.session_credits set balance = 3 where athlete_id = $1`, [ann]);
      await h.as(ann);
      const ins = await tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, credit_state) values ($1, $2, $3, $4, $5, 'waived')`, [coach, ann, group, at(6), at(6, 1)]);
      h.check("after 0265 a client cannot insert a booking directly", !!ins.error, JSON.stringify(ins));

      // the legitimate client path: book_session (takes a session), reschedule, cancel
      const id = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, at(9), at(9, 1)])).id;
      await h.asSuper();
      const b = await h.one(`select credit_state from public.bookings where id = $1`, [id]);
      const bal = (await h.one(`select balance from public.session_credits where athlete_id = $1`, [ann])).balance;
      h.check("a client can still book through book_session: prepaid, one session taken", b.credit_state === "prepaid" && bal === 2, JSON.stringify({ b, bal }));
      await h.as(ann);
      const flip = await tryQ(db, `update public.bookings set credit_state = 'waived' where id = $1 returning credit_state`, [id]);
      const move = await tryQ(db, `update public.bookings set start_at = $2, end_at = $3 where id = $1 returning id`, [id, at(2), at(2, 1)]);
      const cancel = await tryQ(db, `update public.bookings set status = 'cancelled' where id = $1 returning id`, [id]);
      await h.asSuper();
      const after = await h.one(`select credit_state, status from public.bookings where id = $1`, [id]);
      h.check("a client cannot change their booking's credit state, time or status directly", after.credit_state === "prepaid" && after.status === "confirmed", JSON.stringify({ flip, move, cancel, after }));
      await h.as(ann);
      const moved = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [id, at(10), at(10, 1)]);
      h.check("a client can still reschedule through reschedule_booking", !moved.error, JSON.stringify(moved));
      const cancelled = await tryQ(db, `select public.cancel_booking_and_refund_credit($1) as r`, [id]);
      await h.asSuper();
      const bal2 = (await h.one(`select balance from public.session_credits where athlete_id = $1`, [ann])).balance;
      h.check("a client can still cancel through the function, and gets the session back when outside the window", !cancelled.error && bal2 === 3, JSON.stringify({ cancelled, bal2 }));

      // the coach's direct path is unchanged
      await h.as(coach);
      const ok = await tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, credit_state) values ($1, $2, $3, $4, $5, 'unsettled') returning id`, [coach, bo, group, at(11), at(11, 1)]);
      h.check("the coach can still insert a booking for their client", !!ok.rows, JSON.stringify(ok));
      const upd = await tryQ(db, `update public.bookings set session_type = 'video' where id = $1 returning session_type`, [ok.rows?.[0]?.id]);
      h.check("the coach can still edit a booking (e.g. the in-person/video toggle)", upd.rows?.[0]?.session_type === "video", JSON.stringify(upd));
      const other = await h.user("Book Other Coach");
      await h.org(other);
      await h.as(other);
      const steal = await tryQ(db, `update public.bookings set credit_state = 'waived' where id = $1 returning 1`, [ok.rows?.[0]?.id]);
      h.check("a coach of another group cannot edit it", steal.error || steal.rows.length === 0);
      await h.as(coach);
      h.check("a coach cannot move a booking onto a different coach", !!(await tryQ(db, `update public.bookings set coach_id = $2 where id = $1`, [ok.rows?.[0]?.id, other])).error);
    },
  },
};
