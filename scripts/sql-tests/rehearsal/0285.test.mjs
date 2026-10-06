// 0285: a record of the rest-day nudges sent, so they can be limited. Only the server reads or writes it; no signed-in user can.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0285 rest-day nudge record (server only)",
  migrations: ["0285"],
  phases: {
    async "0284"({ db, h }) {
      const c = await h.one(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'rest_day_nudges'`);
      h.check("baseline: nothing records the rest-day nudges that were sent (what 0285 adds)", c.n === 0, JSON.stringify(c));
    },

    async "0285"({ db, h }) {
      const coach = await h.user("N1 Coach");
      const ann = await h.user("N1 Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "N1 group");
      await h.member(group, ann);
      await h.asSuper();

      await h.asService();
      const ins = await tryQ(db, `insert into public.rest_day_nudges (athlete_id, group_id) values ($1, $2)`, [ann, group]);
      const read = await tryQ(db, `select count(*)::int as n from public.rest_day_nudges where athlete_id = $1`, [ann]);
      await h.as(ann);
      const clientRead = await tryQ(db, `select count(*)::int as n from public.rest_day_nudges`);
      const clientWrite = await tryQ(db, `insert into public.rest_day_nudges (athlete_id, group_id) values ($1, $2)`, [ann, group]);
      await h.as(coach);
      const coachRead = await tryQ(db, `select count(*)::int as n from public.rest_day_nudges`);
      await h.asSuper();
      h.check("the server records and reads nudges", !ins.error && read.rows?.[0]?.n === 1, JSON.stringify({ ins, read }));
      h.check("a client or coach cannot read or write the record", !!clientRead.error && !!clientWrite.error && !!coachRead.error, JSON.stringify({ clientRead, clientWrite, coachRead }));
      const when = await h.one(`select (now() - sent_at) < interval '1 minute' as fresh from public.rest_day_nudges where athlete_id = $1`, [ann]);
      h.check("each nudge is stamped with when it was sent", when.fresh === true, JSON.stringify(when));
    },
  },
};
