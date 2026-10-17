// 0387: nothing about a person is public unless they chose it. A coach is listed in Find a coach only after turning it on for themselves (default off, name length limited); a coach can add a person to a
// challenge only if that person is a client in one of the coach's own groups; a client joining their own coach's active challenge is unchanged.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0387 Minors off public surfaces",
  migrations: ["0387"],
  phases: {
    async "0387"({ db, h }) {
      const coach = await h.user("MP Coach");
      const client = await h.user("MP Client");
      const stranger = await h.user("MP Stranger");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "MP team");
      await h.member(group, client);

      await h.asSuper();
      const col = await h.one(`select marketplace_listed, marketplace_display_name from public.profiles where id = $1`, [coach]);
      h.check("a coach is not listed by default and has no display name", col.marketplace_listed === false && col.marketplace_display_name === null);
      await h.as(coach);
      const on = await tryQ(db, `update public.profiles set marketplace_listed = true, marketplace_display_name = 'Coach MP' where id = $1 returning marketplace_listed`, [coach]);
      h.check("a coach can list themselves and choose a name" + (on.error ? ": " + on.error : ""), !on.error && on.rows?.[0]?.marketplace_listed === true);
      const longName = await tryQ(db, `update public.profiles set marketplace_display_name = $2 where id = $1`, [coach, "x".repeat(61)]);
      h.check("a display name over 60 characters is refused", !!longName.error && /marketplace_display_name_length/.test(longName.error), longName.error);

      await h.asSuper();
      const ch = (await db.query(`insert into public.challenges (coach_id, name, start_date, duration_weeks, status) values ($1, 'MP challenge', current_date, 4, 'active') returning id`, [coach])).rows[0].id;
      await h.as(coach);
      const addOwn = await tryQ(db, `insert into public.challenge_participants (challenge_id, profile_id) values ($1, $2) returning profile_id`, [ch, client]);
      h.check("a coach can add their own client to a challenge" + (addOwn.error ? ": " + addOwn.error : ""), !addOwn.error && addOwn.rows?.length === 1);
      const addStranger = await tryQ(db, `insert into public.challenge_participants (challenge_id, profile_id) values ($1, $2) returning profile_id`, [ch, stranger]);
      h.check("...but not a person who is not their client", !!addStranger.error, addStranger.error);

      await h.asSuper();
      const other = await h.user("MP Second Client");
      await h.member(group, other);
      await h.as(other);
      const selfJoin = await tryQ(db, `insert into public.challenge_participants (challenge_id, profile_id) values ($1, $2) returning profile_id`, [ch, other]);
      h.check("a client can still join their own coach's active challenge" + (selfJoin.error ? ": " + selfJoin.error : ""), !selfJoin.error && selfJoin.rows?.length === 1);
      const joinFor = await tryQ(db, `insert into public.challenge_participants (challenge_id, profile_id) values ($1, $2) returning profile_id`, [ch, stranger]);
      h.check("...and cannot put somebody else in", !!joinFor.error, joinFor.error);
    },
  },
};
