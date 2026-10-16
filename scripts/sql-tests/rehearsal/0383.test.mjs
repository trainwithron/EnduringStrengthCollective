// 0383: a STOP sticks to the phone number. Nobody can opt in with a number that replied STOP; dispatch refuses it; START clears it; numbers that stopped before are carried over.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0383 A text STOP is remembered per phone number",
  migrations: ["0383"],
  phases: {
    async "0383"({ db, h }) {
      const coach = await h.user("SM Coach");
      const a = await h.user("SM Client A");
      const b = await h.user("SM Client B");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "SM team");
      await h.member(g, a);
      await h.member(g, b);
      const stopped = "+15555550101";
      const other = "+15555550102";

      // STOP from a number nobody has opted in with
      await h.asService();
      await db.query(`select public.record_sms_stop($1)`, [stopped]);
      await h.asSuper();
      const row = await h.one(`select count(*)::int as n from public.sms_suppressed_numbers where phone_e164 = $1`, [stopped]);
      h.check("a STOP from a number nobody had opted in with is remembered", row.n === 1);

      await h.as(a);
      const blocked = await tryQ(db, `select public.set_sms_consent($1, true, true, 'v1')`, [stopped]);
      h.check("a client cannot opt in with that number", /replied STOP/i.test(blocked.error ?? ""), String(blocked.error));
      const fine = await tryQ(db, `select public.set_sms_consent($1, true, true, 'v1')`, [other]);
      h.check("another number is fine" + (fine.error ? ": " + fine.error : ""), !fine.error);
      const off = await tryQ(db, `select public.set_sms_consent($1, false, false, 'v1')`, [stopped]);
      h.check("turning texts OFF for that number is still allowed", !off.error);

      // a client opted in, then the number replies STOP, then the client moves the number to another account
      await h.as(b);
      await db.query(`select public.set_sms_consent($1, true, true, 'v1')`, [other.replace("2", "3")]);
      const number = other.replace("2", "3");
      await h.asService();
      await db.query(`select public.record_sms_stop($1)`, [number]);
      const d = (await db.query(`select * from public.sms_consent_for_dispatch($1, 'appointments')`, [b])).rows[0];
      h.check("dispatch refuses a number that replied STOP", d.allowed === false && d.reason === "opted_out");
      await h.asSuper();
      // a row that still says opted-in but whose number is on the list is refused too
      await db.query(`update public.athlete_sms_consent set opted_out_at = null where athlete_id = $1`, [b]);
      await h.asService();
      const d2 = (await db.query(`select * from public.sms_consent_for_dispatch($1, 'appointments')`, [b])).rows[0];
      h.check("even when the client's own row was cleared, the number list still refuses it", d2.allowed === false && d2.reason === "opted_out");

      // START clears it
      await db.query(`select public.record_sms_start($1)`, [number]);
      await h.asSuper();
      await db.query(`update public.athlete_sms_consent set opted_out_at = null where athlete_id = $1`, [b]);
      await h.asService();
      const d3 = (await db.query(`select * from public.sms_consent_for_dispatch($1, 'appointments')`, [b])).rows[0];
      h.check("START removes the number and texts can flow again", d3.allowed === true);
      await h.asSuper();
      const gone = await h.one(`select count(*)::int as n from public.sms_suppressed_numbers where phone_e164 = $1`, [number]);
      h.check("the number is gone from the list after START", gone.n === 0);

      // nobody signed in can read or write the list
      await h.as(a);
      h.check("a signed-in person cannot read the list", !!(await tryQ(db, `select * from public.sms_suppressed_numbers`, [])).error);
      h.check("or write to it", !!(await tryQ(db, `insert into public.sms_suppressed_numbers (phone_e164) values ('+15555550999')`, [])).error);
      await h.as(a);
      h.check("and cannot call the STOP handler", !!(await tryQ(db, `select public.record_sms_stop('+15555550998')`, [])).error);
    },
  },
};
