// 0270: a coach can only add a person to their group if that person is a client they already coach (or themselves). The hole exists on the
// live schema today; this proves it, proves the fix, and proves the legitimate adds still work.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0270 group membership insert: a coach can only add their own clients",
  migrations: ["0270"],
  phases: {
    async live({ db, h, state }) {
      const coach = await h.user("M Coach");
      const client = await h.user("M Client");
      const stranger = await h.user("M Stranger");
      const org = await h.org(coach);
      const g1 = await h.group(org, coach, "one_on_one", "M solo");
      const g2 = await h.group(org, coach, "team", "M team");
      await h.member(g1, client);
      Object.assign(state, { coach, client, stranger, g1, g2 });
      await h.as(coach);
      const r = await tryQ(db, `insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete') returning profile_id`, [g2, stranger]);
      await h.asSuper();
      h.check("baseline: on the live schema a coach can add a stranger to their group (the hole 0270 closes)", !!r.rows, JSON.stringify(r));
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [g2, stranger]);
    },

    async "0270"({ db, h, state }) {
      const { coach, client, stranger, g1, g2 } = state;
      await h.as(coach);
      const bad = await tryQ(db, `insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete') returning profile_id`, [g2, stranger]);
      h.check("after 0270 a coach cannot add a stranger to their group", !!bad.error, JSON.stringify(bad));
      const asCoach = await tryQ(db, `insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach') returning profile_id`, [g2, stranger]);
      h.check("nor add a stranger as a coach", !!asCoach.error, JSON.stringify(asCoach));
      const ok = await tryQ(db, `insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete') returning profile_id`, [g2, client]);
      h.check("a coach can still add one of their own clients to another of their groups", !!ok.rows, JSON.stringify(ok));
      const social = await tryQ(db, `update public.group_memberships set membership_type = 'social_only' where group_id = $1 and profile_id = $2 returning 1`, [g2, client]);
      h.check("and change how they belong (social only)", !!social.rows && social.rows.length === 1, JSON.stringify(social));
      // a coach adding themselves to a group they coach (no-op shape the app uses when switching)
      const g3 = await (async () => { await h.asSuper(); return h.group((await h.one(`select organization_id from public.groups where id = $1`, [g1])).organization_id, coach, "team", "M team 2"); })();
      await h.asSuper();
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [g3, coach]);
      await h.as(coach);
      const self = await tryQ(db, `insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach') returning 1`, [g3, coach]);
      h.check("an owner or admin can still add themselves as coach of a group in their organization", !!self.rows, JSON.stringify(self));
      // another coach cannot reach into this coach's group
      await h.asSuper();
      const other = await h.user("M Other Coach");
      await h.org(other);
      await h.as(other);
      const steal = await tryQ(db, `insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete') returning 1`, [g2, stranger]);
      h.check("a coach of another organization cannot add anyone to this group", !!steal.error, JSON.stringify(steal));
      await h.asSuper();
    },
  },
};
