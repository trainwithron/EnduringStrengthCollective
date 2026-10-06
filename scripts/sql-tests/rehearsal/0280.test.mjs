// 0280: credit expiry kept human. A coach can hold expiry for one client, give back sessions that expired (up to what expired, logged, undoable),
// and set how early they are prompted. Nothing happens automatically. Proves the new columns are absent before, and the rules after.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

async function setup(db, h, label) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const other = await h.user(`${label} Other Coach`);
  const org = await h.org(coach);
  const group = await h.group(org, coach, "one_on_one", `${label} group`);
  await h.member(group, ann);
  await h.asSuper();
  // A client whose 9 sessions expired (what the nightly job writes): balance 0 and an 'expired' ledger entry.
  await db.query(`insert into public.session_credits (athlete_id, group_id, balance, last_granted_at) values ($1, $2, 0, now() - interval '200 days')`, [ann, group]);
  await db.query(`insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note) values ($1, $2, 'expired', -9, 0, 'Unused sessions expired')`, [ann, group]);
  return { coach, ann, other, group };
}
const bal = async (h, s) => (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [s.ann, s.group])).balance;

export default {
  name: "0280 credit expiry stays human (hold, reinstate, undo)",
  migrations: ["0280"],
  phases: {
    async "0279"({ db, h }) {
      const col = await h.one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'session_credits' and column_name = 'expiry_hold_until'`);
      h.check("baseline: there is no expiry hold and no way to give expired sessions back (what 0280 adds)", col.n === 0, JSON.stringify(col));
    },

    async "0280"({ db, h }) {
      const s = await setup(db, h, "X1");
      const def = await h.one(`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'expiry_heads_up_days'`);
      h.check("the heads-up window defaults to 30 days", /30/.test(def.column_default), JSON.stringify(def));
      const badDays = await tryQ(db, `insert into public.coach_booking_policies (coach_id, expiry_heads_up_days) values ($1, 999) on conflict (coach_id) do update set expiry_heads_up_days = 999`, [s.coach]);
      h.check("a heads-up window over a year is refused", !!badDays.error, JSON.stringify(badDays));

      // ---- hold
      const until = new Date(Date.now() + 40 * 86400000).toISOString();
      await h.as(s.ann);
      const byClient = await tryQ(db, `select public.set_credit_expiry_hold($1, $2, $3, 'please')`, [s.ann, s.group, until]);
      await h.as(s.other);
      const byOther = await tryQ(db, `select public.set_credit_expiry_hold($1, $2, $3, 'x')`, [s.ann, s.group, until]);
      await h.asSuper();
      h.check("a client or an unrelated coach cannot hold expiry", !!byClient.error && !!byOther.error, JSON.stringify({ byClient, byOther }));
      await h.as(s.coach);
      const tooFar = await tryQ(db, `select public.set_credit_expiry_hold($1, $2, now() + interval '9 years', null)`, [s.ann, s.group]);
      const past = await tryQ(db, `select public.set_credit_expiry_hold($1, $2, now() - interval '1 day', null)`, [s.ann, s.group]);
      const ok = await tryQ(db, `select public.set_credit_expiry_hold($1, $2, $3, 'Away until winter')`, [s.ann, s.group, until]);
      await h.asSuper();
      const row = await h.one(`select expiry_hold_until from public.session_credits where athlete_id = $1 and group_id = $2`, [s.ann, s.group]);
      const led = await h.rows(`select amount, kind, note from public.session_credit_ledger where athlete_id = $1 and kind = 'adjusted'`, [s.ann]);
      h.check("the coach holds expiry with a note; a hold in the past or beyond five years is refused", !ok.error && !!tooFar.error && !!past.error && !!row.expiry_hold_until, JSON.stringify({ ok, tooFar, past, row }));
      h.check("the hold is in the ledger with the note and moves no sessions", led.length === 1 && led[0].amount === 0 && /Expiry held until/.test(led[0].note) && /Away until winter/.test(led[0].note), JSON.stringify(led));
      const aud = await h.rows(`select changed from public.audit_log where table_name = 'session_credits' and changed ? 'expiry_hold_until'`);
      h.check("a hold change is recorded in the audit trail", aud.length >= 1, JSON.stringify(aud));
      await h.as(s.coach);
      await tryQ(db, `select public.set_credit_expiry_hold($1, $2, null, null)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("the coach can clear the hold", (await h.one(`select expiry_hold_until from public.session_credits where athlete_id = $1`, [s.ann])).expiry_hold_until === null, "");
      const none = await h.user("X1 Nobody");
      await h.as(s.coach);
      const noRow = await tryQ(db, `select public.set_credit_expiry_hold($1, $2, $3, null)`, [none, s.group, until]);
      await h.asSuper();
      h.check("a client with no balance row is refused plainly", /no session balance/.test(noRow.error ?? ""), JSON.stringify(noRow));

      // ---- reinstate
      const avail0 = await h.one(`select public.reinstatable_expired_credits($1, $2) as n`, [s.ann, s.group]);
      h.check("what expired and has not been given back: 9", avail0.n === 9, JSON.stringify(avail0));
      await h.as(s.other);
      const peekOther = await tryQ(db, `select public.reinstatable_expired_credits($1, $2) as n`, [s.ann, s.group]);
      await h.as(s.ann);
      const peekSelf = await tryQ(db, `select public.reinstatable_expired_credits($1, $2) as n`, [s.ann, s.group]);
      await h.as(s.coach);
      const peekCoach = await tryQ(db, `select public.reinstatable_expired_credits($1, $2) as n`, [s.ann, s.group]);
      await h.asSuper();
      h.check("only the client, the group's coach or the server can read the expired-session count", !!peekOther.error && peekSelf.rows?.[0]?.n === 9 && peekCoach.rows?.[0]?.n === 9, JSON.stringify({ peekOther, peekSelf, peekCoach }));
      await h.as(s.ann);
      const rClient = await tryQ(db, `select public.reinstate_expired_credits($1, $2, 3, null)`, [s.ann, s.group]);
      await h.as(s.other);
      const rOther = await tryQ(db, `select public.reinstate_expired_credits($1, $2, 3, null)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("a client or an unrelated coach cannot give sessions back", !!rClient.error && !!rOther.error && (await bal(h, s)) === 0, JSON.stringify({ rClient, rOther }));
      await h.as(s.coach);
      const r0 = await tryQ(db, `select public.reinstate_expired_credits($1, $2, 0, null)`, [s.ann, s.group]);
      const tooMany = await tryQ(db, `select public.reinstate_expired_credits($1, $2, 12, null)`, [s.ann, s.group]);
      const r4 = await tryQ(db, `select public.reinstate_expired_credits($1, $2, 4, 'Back from Washington') as b`, [s.ann, s.group]);
      await h.asSuper();
      h.check("the coach gives back 4 of the 9, with a note; zero or more than expired is refused", !r4.error && r4.rows?.[0]?.b === 4 && !!r0.error && /only 9/.test(tooMany.error ?? "") && (await bal(h, s)) === 4, JSON.stringify({ r4, r0, tooMany }));
      const led2 = await h.rows(`select amount, note from public.session_credit_ledger where athlete_id = $1 and note like 'Reinstated%'`, [s.ann]);
      h.check("it is in the ledger as an adjustment with the note", led2.length === 1 && led2[0].amount === 4 && /Back from Washington/.test(led2[0].note), JSON.stringify(led2));
      const clock = await h.one(`select (now() - last_granted_at) < interval '1 minute' as fresh from public.session_credits where athlete_id = $1`, [s.ann]);
      h.check("the expiry clock restarts for the sessions given back", clock.fresh === true, JSON.stringify(clock));
      h.check("5 expired sessions are still available to give back", (await h.one(`select public.reinstatable_expired_credits($1, $2) as n`, [s.ann, s.group])).n === 5, "");
      await h.as(s.coach);
      const r6 = await tryQ(db, `select public.reinstate_expired_credits($1, $2, 6, null)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("the same expired sessions cannot be given back twice", /only 5/.test(r6.error ?? ""), JSON.stringify(r6));

      // ---- undo
      await h.as(s.coach);
      const u2 = await tryQ(db, `select public.undo_expired_reinstatement($1, $2, 2) as b`, [s.ann, s.group]);
      const uTooMany = await tryQ(db, `select public.undo_expired_reinstatement($1, $2, 9)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("the coach can undo some of a reinstatement, which logs it", !u2.error && u2.rows?.[0]?.b === 2 && !!uTooMany.error, JSON.stringify({ u2, uTooMany }));
      h.check("after the undo 7 expired sessions are available again", (await h.one(`select public.reinstatable_expired_credits($1, $2) as n`, [s.ann, s.group])).n === 7, "");
      const rec = await h.rows(`select amount, undone_amount from public.session_credit_reinstatements where athlete_id = $1`, [s.ann]);
      h.check("the give-back is recorded in its own table, not read from notes", rec.length === 1 && rec[0].amount === 4 && rec[0].undone_amount === 2, JSON.stringify(rec));
      // sessions bought after the give-back: an undo must not take those
      await db.query(`select public.apply_session_credit_change($1, $2, 5, 'purchased', 'Bought a pack', null, null)`, [s.ann, s.group]);
      await h.as(s.coach);
      const afterBuy = await tryQ(db, `select public.undo_expired_reinstatement($1, $2, 1)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("an undo is refused once the client's sessions have changed since the give-back", /changed since/.test(afterBuy.error ?? ""), JSON.stringify(afterBuy));
      await db.query(`update public.session_credits set balance = 1 where athlete_id = $1 and group_id = $2`, [s.ann, s.group]);
      await h.as(s.coach);
      const used =await tryQ(db, `select public.undo_expired_reinstatement($1, $2, 2)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("an undo is refused when the client has already used those sessions", /already used/.test(used.error ?? ""), JSON.stringify(used));

      const priv = await h.one(`select has_function_privilege('anon', 'public.reinstate_expired_credits(uuid, uuid, integer, text)', 'execute') as a, has_function_privilege('anon', 'public.set_credit_expiry_hold(uuid, uuid, timestamptz, text)', 'execute') as b, has_function_privilege('anon', 'public.undo_expired_reinstatement(uuid, uuid, integer)', 'execute') as c`);
      h.check("the new functions are closed to the signed-out role", priv.a === false && priv.b === false && priv.c === false, JSON.stringify(priv));
    },
  },
};
