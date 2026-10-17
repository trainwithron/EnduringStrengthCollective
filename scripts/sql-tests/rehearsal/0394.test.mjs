// 0394: next season for a team. The old group is retired (kept whole); the new one has the same organization, kind, positions and coaches and the athletes chosen.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0394 Team seasons",
  migrations: ["0394"],
  phases: {
    async "0394"({ db, h }) {
      const coach = await h.user("TS Coach");
      const assistant = await h.user("TS Assistant Coach");
      const outsider = await h.user("TS Outsider");
      const a1 = await h.user("TS Athlete One");
      const a2 = await h.user("TS Athlete Two");
      const a3 = await h.user("TS Athlete Leaving");
      const org = await h.org(coach, "TS School");
      const team = await h.group(org, coach, "team", "TS Varsity 2026");
      await h.member(team, assistant, "coach");
      await h.member(team, a1);
      await h.member(team, a2);
      await h.member(team, a3);
      await h.asSuper();
      await db.query(`update public.groups set team_mode = true, description = 'Varsity squad' where id = $1`, [team]);
      const qb = (await db.query(`insert into public.group_positions (group_id, name, sort_order) values ($1, 'QB', 1) returning id`, [team])).rows[0].id;
      const wr = (await db.query(`insert into public.group_positions (group_id, name, sort_order) values ($1, 'WR', 2) returning id`, [team])).rows[0].id;
      await db.query(`update public.group_memberships set position_id = $1, depth_order = 1 where group_id = $2 and profile_id = $3`, [qb, team, a1]);
      await db.query(`update public.group_memberships set position_id = $1, depth_order = 2, private_from_org = true where group_id = $2 and profile_id = $3`, [wr, team, a2]);
      await db.query(`update public.group_memberships set coach_position_id = $1 where group_id = $2 and profile_id = $3`, [wr, team, assistant]);
      const social = await h.group(org, coach, "social", "TS Social");
      const solo = await h.group(org, coach, "one_on_one", "TS Solo");

      // ---- who may start one, and what for
      await h.as(outsider);
      let r = await tryQ(db, `select public.start_new_season($1, 'X', array[$2]::uuid[])`, [team, a1]);
      h.check("someone who does not coach the team cannot start its next season", /Only a coach/.test(r.error ?? ""), r.error);
      await h.as(coach);
      r = await tryQ(db, `select public.start_new_season($1, 'X', '{}')`, [social]);
      h.check("a social group has no seasons", /for a team/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.start_new_season($1, 'X', '{}')`, [solo]);
      h.check("nor does a client's own space", /for a team/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.start_new_season($1, '   ', '{}')`, [team]);
      h.check("the new season needs a name", /Give the new season a name/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.start_new_season($1, 'X', array[$2]::uuid[])`, [team, outsider]);
      h.check("only athletes on this roster can be brought over", /must be on this season/.test(r.error ?? ""), r.error);
      await h.asSuper();
      h.check("a refused call changes nothing", (await db.query(`select archived_at from public.groups where id = $1`, [team])).rows[0].archived_at === null);

      // ---- the season
      await h.as(coach);
      r = await tryQ(db, `select public.start_new_season($1, 'TS Varsity 2027', array[$2, $3]::uuid[]) as id`, [team, a1, a2]);
      h.check("the coach starts next season" + (r.error ? ": " + r.error : ""), !r.error);
      const next = r.rows?.[0]?.id;
      await h.asSuper();
      const g = (await db.query(`select * from public.groups where id = $1`, [next])).rows[0];
      h.check("it is a team in the same organization with the same settings", g.group_kind === "team" && g.organization_id === org && g.team_mode === true && g.description === "Varsity squad" && g.name === "TS Varsity 2027");
      const pos = (await db.query(`select name from public.group_positions where group_id = $1 order by sort_order`, [next])).rows.map((x) => x.name);
      h.check("it has the same positions", pos.join() === "QB,WR", pos.join());
      const members = (await db.query(`select m.profile_id, m.role, m.depth_order, m.private_from_org, p.name as position from public.group_memberships m left join public.group_positions p on p.id = m.position_id where m.group_id = $1`, [next])).rows;
      const by = Object.fromEntries(members.map((m) => [m.profile_id, m]));
      h.check("both coaches are in it", by[coach]?.role === "coach" && by[assistant]?.role === "coach");
      const scope = (await db.query(`select p.name from public.group_memberships m join public.group_positions p on p.id = m.coach_position_id where m.group_id = $1 and m.profile_id = $2`, [next, assistant])).rows[0];
      h.check("the assistant coach keeps the position they were responsible for, on the new group's own position", scope?.name === "WR");
      h.check("the athletes chosen are in it in the same place on the depth chart", by[a1]?.position === "QB" && by[a1]?.depth_order === 1 && by[a2]?.position === "WR" && by[a2]?.depth_order === 2);
      h.check("a client's private-from-the-organization setting travels with them", by[a2]?.private_from_org === true && by[a1]?.private_from_org !== true);
      h.check("the athlete left out is not in the new season", !by[a3]);
      h.check("the old season is retired and kept whole (its roster is untouched)", (await db.query(`select archived_at from public.groups where id = $1`, [team])).rows[0].archived_at != null && (await db.query(`select count(*)::int as n from public.group_memberships where group_id = $1 and role = 'athlete'`, [team])).rows[0].n === 3);
      h.check("the change is on the audit trail", (await db.query(`select count(*)::int as n from public.audit_log where table_name = 'groups' and changed ->> 'event' = 'start_new_season'`)).rows[0].n >= 1);

      await h.as(coach);
      r = await tryQ(db, `select public.start_new_season($1, 'Again', '{}')`, [team]);
      h.check("a retired season cannot be started again", /already been retired/.test(r.error ?? ""), r.error);

      // ---- bring it back
      await h.as(outsider);
      r = await tryQ(db, `select public.unarchive_group($1)`, [team]);
      h.check("only a coach can bring a season back", !!r.error);
      await h.as(coach);
      r = await tryQ(db, `select public.unarchive_group($1)`, [team]);
      h.check("a coach brings a retired season back", !r.error, r.error);
      await h.asSuper();
      h.check("it is no longer retired", (await db.query(`select archived_at from public.groups where id = $1`, [team])).rows[0].archived_at === null);
    },
  },
};
