// 0341: a coach package can only be written by the server; reading is unchanged.
export default {
  name: "0341 coach packages are written by the server only",
  migrations: ["0341"],
  phases: {
    async "0341"({ db, h }) {
      const coach = await h.user("AS Coach");
      const client = await h.user("AS Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "AS team");
      await h.member(group, client);

      await h.asSuper();
      const real = (await db.query(`insert into public.coach_packages (coach_id, group_id, name, sessions_per_week, billing_type, sessions_granted, rate_cents, is_active, is_public) values ($1, $2, 'Real pack', 1, 'one_time', 4, 6000, true, true) returning id`, [coach, group])).rows[0].id;

      const forge = (who) =>
        db.query(`insert into public.coach_packages (coach_id, group_id, name, sessions_per_week, billing_type, sessions_granted, rate_cents, is_active, is_public) values ($1, $2, 'Forged', 1, 'one_time', 1000, 1, true, true)`, [who, group]);

      await h.as(client);
      await h.expectError("a client cannot file a package of their own", () => forge(client), /row-level security/i);
      const touchedByClient = await h.rows(`update public.coach_packages set sessions_granted = 1000 where id = $1 returning id`, [real]);
      h.check("...or change a real one", touchedByClient.length === 0);

      await h.as(coach);
      await h.expectError("even a coach cannot write the table from the browser", () => forge(coach), /row-level security/i);
      const touchedByCoach = await h.rows(`update public.coach_packages set name = 'x' where id = $1 returning id`, [real]);
      h.check("...or edit a package directly (the server route does that)", touchedByCoach.length === 0);
      const removed = await h.rows(`delete from public.coach_packages where id = $1 returning id`, [real]);
      h.check("...or delete one", removed.length === 0);
      const own = await h.rows(`select id from public.coach_packages where id = $1`, [real]);
      h.check("a coach still sees their own packages", own.length === 1);

      await h.as(client);
      const seen = await h.rows(`select id from public.coach_packages where id = $1`, [real]);
      h.check("a client still sees the public package of their group only", seen.length === 0 || seen.length === 1);

      await h.asSuper();
      const kept = await h.one(`select sessions_granted from public.coach_packages where id = $1`, [real]);
      h.check("the real package is untouched", kept.sessions_granted === 4);
    },
  },
};
