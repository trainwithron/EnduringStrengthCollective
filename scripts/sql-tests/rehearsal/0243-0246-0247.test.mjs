// The migrations that are already live, re-proven on the live-equivalent schema: 0243 (email_changed notification type), 0246 (session credit
// ledger, assign sessions, set balance), 0247 (rate limiter).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0243 email-changed notification, 0246 session ledger and assign, 0247 rate limiter",
  migrations: ["0243", "0246", "0247"],
  phases: {
    async live({ db, h }) {
      const coach = await h.user("Live Coach");
      const ann = await h.user("Live Ann");
      const bo = await h.user("Live Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Live group");
      await h.member(group, ann);
      await h.member(group, bo);

      // ---- 0243
      await h.asSuper();
      h.check("0243: the email_changed notification type is accepted", !!(await tryQ(db, `insert into public.notifications (profile_id, group_id, type, body, link_path) values ($1, $2, 'email_changed', 'Your email was updated', '/') returning id`, [ann, group])).rows);
      h.check("0243: an unknown notification type is still refused", !!(await tryQ(db, `insert into public.notifications (profile_id, group_id, type, body, link_path) values ($1, $2, 'made_up', 'x', '/') returning id`, [ann, group])).error);

      // ---- 0246
      await h.as(coach);
      let r = await tryQ(db, `select public.assign_session_credits($1, $2, 5, 'starter') as b`, [ann, group]);
      h.check("0246: a coach can assign sessions to their client", r.rows?.[0]?.b === 5, JSON.stringify(r));
      r = await tryQ(db, `select public.set_session_balance($1, $2, 3, 'correction') as b`, [ann, group]);
      h.check("0246: a coach can set a balance (a correction, not a guess)", r.rows?.[0]?.b === 3, JSON.stringify(r));
      await h.asSuper();
      const ledger = (await h.rows(`select kind, amount, balance_after from public.session_credit_ledger where athlete_id = $1 order by created_at`, [ann]));
      h.check("0246: every change is in the ledger with the balance after it", ledger.length === 2 && ledger[0].balance_after === 5 && ledger[1].balance_after === 3, JSON.stringify(ledger));
      await h.as(ann);
      h.check("0246: a client reads their own ledger", (await h.rows(`select 1 from public.session_credit_ledger`)).length === 2);
      h.check("0246: a client cannot assign themselves sessions", !!(await tryQ(db, `select public.assign_session_credits($1, $2, 99, 'me')`, [ann, group])).error);
      h.check("0246: a client cannot set their own balance", !!(await tryQ(db, `select public.set_session_balance($1, $2, 99, 'me')`, [ann, group])).error);
      h.check("0246: a client cannot write a ledger row", !!(await tryQ(db, `insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after) values ($1, $2, 'assigned', 99, 99)`, [ann, group])).error);
      await h.as(bo);
      h.check("0246: another client does not see someone else's ledger", (await h.rows(`select 1 from public.session_credit_ledger where athlete_id = $1`, [ann])).length === 0);
      const other = await h.user("Live Other Coach");
      await h.org(other);
      await h.as(other);
      h.check("0246: a coach of another group cannot assign sessions to this client", !!(await tryQ(db, `select public.assign_session_credits($1, $2, 5, 'x')`, [ann, group])).error);

      // ---- 0247
      await h.asService();
      const hits = [];
      for (let i = 0; i < 4; i++) hits.push((await h.one(`select public.rate_limit_hit('test:ip:1', 3, 600) as ok`)).ok);
      h.check("0247: the limiter lets three through and refuses the fourth", hits.join() === "true,true,true,false", hits.join());
      h.check("0247: a different key has its own count", (await h.one(`select public.rate_limit_hit('test:ip:2', 3, 600) as ok`)).ok === true);
      h.check("0247: nonsense arguments are refused", !!(await tryQ(db, `select public.rate_limit_hit('', 3, 600)`)).error && !!(await tryQ(db, `select public.rate_limit_hit('k', 0, 600)`)).error);
      await h.as(ann);
      h.check("0247: a signed-in user cannot call the limiter", !!(await tryQ(db, `select public.rate_limit_hit('x', 3, 600)`)).error);
      h.check("0247: nor read its table", (await h.rows(`select 1 from public.rate_limit_hits`)).length === 0);
      await h.as(null);
      h.check("0247: nor a signed-out visitor", !!(await tryQ(db, `select public.rate_limit_hit('x', 3, 600)`)).error);
    },
  },
};
