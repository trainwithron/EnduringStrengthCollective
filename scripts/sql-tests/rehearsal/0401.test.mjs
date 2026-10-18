// 0401: a team player's graduation year is the coach's to set and travels with the player into next season; who has been emailed their history is a server-only record.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0401 Graduation years",
  migrations: ["0401"],
  phases: {
    async "0401"({ db, h }) {
      const coach = await h.user("GR Coach");
      const senior = await h.user("GR Senior");
      const junior = await h.user("GR Junior");
      const other = await h.user("GR Other Coach");
      const org = await h.org(coach, "GR School");
      await h.orgMember(org, other, "coach");
      const g = await h.group(org, coach, "team", "GR Varsity 2026");
      await h.member(g, senior);
      await h.member(g, junior);

      // ---- who can set the year
      await h.as(coach);
      let r = await tryQ(db, `update public.group_memberships set graduation_year = 2026 where group_id = $1 and profile_id = $2`, [g, senior]);
      h.check("a coach sets a player's graduation year" + (r.error ? ": " + r.error : ""), !r.error);
      r = await tryQ(db, `update public.group_memberships set graduation_year = 2027 where group_id = $1 and profile_id = $2`, [g, junior]);
      h.check("and another's", !r.error);
      r = await tryQ(db, `update public.group_memberships set graduation_year = 1980 where group_id = $1 and profile_id = $2`, [g, junior]);
      h.check("a year before 1990 is refused", !!r.error);
      r = await tryQ(db, `update public.group_memberships set graduation_year = 2101 where group_id = $1 and profile_id = $2`, [g, junior]);
      h.check("and one after 2100", !!r.error);
      await h.as(junior);
      r = await tryQ(db, `update public.group_memberships set graduation_year = 2030 where group_id = $1 and profile_id = $2 returning 1`, [g, junior]);
      h.check("a player cannot change their own year", !r.error && r.rows.length === 0, JSON.stringify(r));
      await h.as(other);
      r = await tryQ(db, `update public.group_memberships set graduation_year = 2030 where group_id = $1 and profile_id = $2 returning 1`, [g, junior]);
      h.check("nor can a coach of another group", !r.error && r.rows.length === 0, JSON.stringify(r));
      await h.asSuper();
      h.check("the years stand as the coach set them", (await db.query(`select graduation_year from public.group_memberships where group_id = $1 and profile_id = $2`, [g, junior])).rows[0].graduation_year === 2027);

      // ---- the record of who was emailed is the server's only
      await db.query(`insert into public.graduation_exports (group_id, athlete_id) values ($1, $2)`, [g, senior]);
      for (const [who, label] of [[coach, "the coach"], [senior, "the player"]]) {
        await h.as(who);
        r = await tryQ(db, `select count(*)::int as n from public.graduation_exports`);
        h.check(label + " cannot read who has been emailed", !!r.error || r.rows[0].n === 0, JSON.stringify(r));
        r = await tryQ(db, `insert into public.graduation_exports (group_id, athlete_id) values ($1, $2)`, [g, junior]);
        h.check(label + " cannot write it", !!r.error);
      }
      await h.asSuper();
      r = await tryQ(db, `insert into public.graduation_exports (group_id, athlete_id) values ($1, $2)`, [g, senior]);
      h.check("a player is recorded once per season", !!r.error);

      // ---- the deciding year cannot be written directly, by a coach or by anyone
      await h.as(coach);
      r = await tryQ(db, `update public.groups set graduates_through = 2026 where id = $1`, [g]);
      h.check("a coach cannot change the graduation year of a season directly", !!r.error, JSON.stringify(r));
      await h.asSuper();
      r = await tryQ(db, `update public.groups set graduates_through = 2026 where id = $1`, [g]);
      h.check("nor can anyone else outside start_next_season", !!r.error, JSON.stringify(r));
      r = await tryQ(db, `update public.groups set name = name where id = $1`, [g]);
      h.check("other changes to the season are untouched", !r.error, JSON.stringify(r));

      // ---- a made-up year is ignored (only this year or the next to it is kept)
      const g2 = await h.group(org, coach, "team", "GR Other 2026");
      await h.member(g2, senior);
      await h.as(coach);
      r = await tryQ(db, `select public.start_next_season($1, 'GR Other 2027', $2::uuid[], 2099) as id`, [g2, [senior]]);
      await h.asSuper();
      h.check("a made-up year is not kept", !r.error && (await db.query(`select graduates_through from public.groups where id = $1`, [g2])).rows[0].graduates_through === null, JSON.stringify(r));

      // ---- only a coach of the season can start the next one (the existing rule, kept)
      await h.as(other);
      r = await tryQ(db, `select public.start_next_season($1, 'Nope', $2::uuid[])`, [g, [junior]]);
      h.check("a coach of another group cannot start this season's successor", !!r.error);
      await h.as(junior);
      r = await tryQ(db, `select public.start_next_season($1, 'Nope', $2::uuid[])`, [g, [junior]]);
      h.check("nor a player", !!r.error);
      await h.asSuper();
      h.check("and nothing was started", (await db.query(`select count(*)::int as n from public.groups where name = 'Nope'`)).rows[0].n === 0);

      // ---- next season: the year travels with a player who stays, and the unticked senior is left behind
      await h.as(coach);
      r = await tryQ(db, `select public.start_next_season($1, 'GR Varsity 2027', $2::uuid[], $3::int) as id`, [g, [junior], new Date().getFullYear()]);
      await h.asSuper();
      h.check("the coach starts next season with only the junior" + (r.error ? ": " + r.error : ""), !r.error && !!r.rows?.[0]?.id);
      const next = r.rows?.[0]?.id;
      h.check("the junior's graduation year came with them", (await db.query(`select graduation_year from public.group_memberships where group_id = $1 and profile_id = $2`, [next, junior])).rows[0]?.graduation_year === 2027);
      h.check("the senior is not on the new roster", (await db.query(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2`, [next, senior])).rows[0].n === 0);
      h.check("the senior's place and year in last season are untouched", (await db.query(`select graduation_year from public.group_memberships where group_id = $1 and profile_id = $2`, [g, senior])).rows[0]?.graduation_year === 2026);
      h.check("the year that decided who graduated is kept on the retired season", (await db.query(`select graduates_through from public.groups where id = $1`, [g])).rows[0].graduates_through === new Date().getFullYear());
      h.check("last season is retired and points at the new one", (await db.query(`select archived_at is not null as a, next_season_id = $2 as n from public.groups where id = $1`, [g, next])).rows[0].a === true);
    },
  },
};
