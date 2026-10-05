// 0264: a client must not be able to rewrite their own session balance or payment hold through the API. The hole exists on the live database
// today (0110's policy consolidation re-added the athlete branch that 0085 had removed); this proves it, then proves the fix.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0264 clients cannot edit their own session balance",
  migrations: ["0264"],
  phases: {
    async live({ db, h, state }) {
      const coach = await h.user("Credit Coach");
      const ann = await h.user("Credit Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Credit group");
      await h.member(group, ann);
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 2)`, [ann, group]);
      Object.assign(state, { coach, ann, group });
      await h.as(ann);
      const r = await tryQ(db, `update public.session_credits set balance = 99 where athlete_id = $1 and group_id = $2 returning balance`, [ann, group]);
      h.check("baseline: on the live schema a client can set their own session balance straight through the table (the hole 0264 closes)", r.rows?.[0]?.balance === 99, JSON.stringify(r));
    },

    async "0264"({ db, h, state }) {
      const { coach, ann, group } = state;
      await h.asSuper();
      await db.query(`update public.session_credits set balance = 2 where athlete_id = $1`, [ann]);
      await h.as(ann);
      const r = await tryQ(db, `update public.session_credits set balance = 99 where athlete_id = $1 and group_id = $2 returning balance`, [ann, group]);
      await h.asSuper();
      h.check("after 0264 a client's direct update of their own balance changes nothing", (r.error || r.rows.length === 0) && (await h.one(`select balance from public.session_credits where athlete_id = $1`, [ann])).balance === 2, JSON.stringify(r));
      await h.as(ann);
      h.check("a client still reads their own balance", (await h.rows(`select balance from public.session_credits`)).length === 1);
      await h.as(coach);
      const c = await tryQ(db, `update public.session_credits set payment_hold = true where athlete_id = $1 and group_id = $2 returning payment_hold`, [ann, group]);
      h.check("a coach can still update their client's row directly", c.rows?.[0]?.payment_hold === true, JSON.stringify(c));
      await db.query(`select public.assign_session_credits($1, $2, 3, 'top up')`, [ann, group]);
      await h.asSuper();
      h.check("and the credit functions still work", (await h.one(`select balance from public.session_credits where athlete_id = $1`, [ann])).balance === 5);
      const other = await h.user("Credit Other Coach");
      await h.org(other);
      await h.as(other);
      const o = await tryQ(db, `update public.session_credits set balance = 0 where athlete_id = $1 returning 1`, [ann]);
      h.check("a coach of another group cannot touch the row", o.error || o.rows.length === 0);
    },
  },
};
