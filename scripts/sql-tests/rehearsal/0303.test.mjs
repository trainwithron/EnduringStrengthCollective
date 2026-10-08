// 0303: what a client pays is coach-only. Before it, the monthly rate sits on the roster row that every member of the group can read; after it, the rate lives in its own table that
// only the group's coaches can read or write, the existing values were copied across, and the old column is gone.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0303 client rates are coach-only",
  migrations: ["0303"],
  phases: {
    async "0302"({ db, h }) {
      const coach = await h.user("CR Coach");
      const ann = await h.user("CR Ann");
      const bob = await h.user("CR Bob");
      const other = await h.user("CR Other Coach");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "CR group");
      await h.member(group, ann);
      await h.member(group, bob);
      const otherOrg = await h.org(other);
      await h.group(otherOrg, other, "team", "CR other group");
      await h.asSuper();
      await db.query(`update public.group_memberships set monthly_rate = 150 where group_id = $1 and profile_id = $2`, [group, ann]);
      // the problem this migration fixes: before it, another client in the group can read what Ann pays
      await h.as(bob);
      const leak = await tryQ(db, `select monthly_rate from public.group_memberships where group_id = $1 and profile_id = $2`, [group, ann]);
      h.check("before 0303 another client in the group CAN read what a client pays (the problem)", Number(leak.rows?.[0]?.monthly_rate) === 150, JSON.stringify(leak));
      globalThis.__cr = { coach, ann, bob, other, group, org };
    },

    async "0303"({ db, h }) {
      const { coach, ann, bob, other, group } = globalThis.__cr;
      await h.asSuper();
      const col = await h.one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'`);
      h.check("the rate column is gone from the roster table", col.n === 0, JSON.stringify(col));
      const copied = await h.rows(`select profile_id, monthly_rate::int as r from public.client_billing_rates where group_id = $1`, [group]);
      h.check("the existing rate was copied across, and only members that had one", copied.length === 1 && copied[0].profile_id === ann && copied[0].r === 150, JSON.stringify(copied));

      await h.as(coach);
      const mine = await tryQ(db, `select monthly_rate::int as r from public.client_billing_rates where group_id = $1`, [group]);
      h.check("the group's coach can read the rates", !mine.error && mine.rows?.length === 1 && mine.rows[0].r === 150, JSON.stringify(mine));

      await h.as(bob);
      const bobSees = await tryQ(db, `select * from public.client_billing_rates`);
      h.check("another client in the group sees no rates at all", !bobSees.error && (bobSees.rows?.length ?? 0) === 0, JSON.stringify(bobSees));
      await h.as(ann);
      const annSees = await tryQ(db, `select * from public.client_billing_rates`);
      h.check("the client themselves cannot see their own rate row either", !annSees.error && (annSees.rows?.length ?? 0) === 0, JSON.stringify(annSees));
      const annWrites = await tryQ(db, `insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate) select id, group_id, profile_id, 1 from public.group_memberships where group_id = $1 and profile_id = $2 on conflict (membership_id) do update set monthly_rate = 1 returning monthly_rate`, [group, ann]);
      h.check("a client cannot write a rate", !!annWrites.error, JSON.stringify(annWrites));

      await h.asSuper();
      const bobMembership = (await h.one(`select id from public.group_memberships where group_id = $1 and profile_id = $2`, [group, bob])).id;
      await h.as(other);
      const otherSees = await tryQ(db, `select * from public.client_billing_rates`);
      h.check("a coach of another organization sees no rates", !otherSees.error && (otherSees.rows?.length ?? 0) === 0, JSON.stringify(otherSees));
      const otherWrites = await tryQ(db, `insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate) values ($1, $2, $3, 5)`, [bobMembership, group, bob]);
      h.check("...and cannot write one for a client that is not theirs", !!otherWrites.error, JSON.stringify(otherWrites));

      await h.as(coach);
      const set = await tryQ(db, `insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate) select id, group_id, profile_id, 99.5 from public.group_memberships where group_id = $1 and profile_id = $2 returning monthly_rate::float as r`, [group, bob]);
      h.check("the coach can set a client's rate", !set.error && set.rows?.[0]?.r === 99.5, JSON.stringify(set));
      const change = await tryQ(db, `update public.client_billing_rates set monthly_rate = 120 where group_id = $1 and profile_id = $2 returning monthly_rate::int as r`, [group, bob]);
      h.check("...and change it", !change.error && change.rows?.[0]?.r === 120, JSON.stringify(change));
      const mismatch = await tryQ(db, `insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate) select id, group_id, $3, 10 from public.group_memberships where group_id = $1 and profile_id = $2 on conflict (membership_id) do nothing`, [group, ann, bob]);
      h.check("a row whose person does not match the membership is refused", !!mismatch.error, JSON.stringify(mismatch));
      const negative = await tryQ(db, `update public.client_billing_rates set monthly_rate = -5 where group_id = $1 and profile_id = $2`, [group, bob]);
      h.check("a negative rate is refused", !!negative.error, JSON.stringify(negative));
      void other;
    },
  },
};
