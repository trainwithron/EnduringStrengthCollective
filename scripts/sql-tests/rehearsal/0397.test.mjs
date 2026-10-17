// 0397: the free plan's client limit. Installed switched off; switched on here the way the later step will, then back.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0397 Free plan client limit",
  migrations: ["0397"],
  phases: {
    async "0397"({ db, h }) {
      const owner = await h.user("FT Owner");
      const org = await h.org(owner, "FT Gym");
      const clients = [];
      const group = await h.group(org, owner, "team", "FT team");
      for (let i = 0; i < 15; i++) {
        const c = await h.user("FT Client " + i);
        clients.push(c);
        await h.member(group, c);
      }
      const extra = await h.user("FT Extra Client");
      const social = await h.user("FT Social");
      await h.asSuper();
      const addAthlete = async (g, who, type = "training") => tryQ(db, `insert into public.group_memberships (group_id, profile_id, role, membership_type) values ($1, $2, 'athlete', $3)`, [g, who, type]);
      const setSwitch = (on) => db.query(`create or replace function public.free_tier_clients_enforced() returns boolean language sql stable set search_path = public as $$ select ${on} $$`);
      const makeOld = (id) => db.query(`update public.organizations set created_at = now() - interval '100 days' where id = $1`, [id]);

      // ---- switched off (as installed): nothing changes, whatever the plan
      await makeOld(org);
      let r = await addAthlete(group, extra);
      h.check("switched off, a 16th client can be added" + (r.error ? ": " + r.error : ""), !r.error);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [group, extra]);

      // ---- switched on
      await setSwitch(true);
      r = await addAthlete(group, extra);
      h.check("switched on, the free plan refuses a 16th training client with a plain message", /up to 15 clients/.test(r.error ?? ""), r.error);
      r = await addAthlete(group, social, "social_only");
      h.check("a social-only member is not a client and is let in", !r.error, r.error);
      r = await tryQ(db, `update public.group_memberships set membership_type = 'training' where group_id = $1 and profile_id = $2`, [group, social]);
      h.check("turning a social member into a 16th training client is refused too", /up to 15 clients/.test(r.error ?? ""), r.error);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [group, social]);

      const group2 = await h.group(org, owner, "team", "FT second team");
      r = await addAthlete(group2, clients[0]);
      h.check("someone who is already one of the 15 can join another group of the same organization", !r.error, r.error);
      r = await tryQ(db, `select count(*)::int as n from public.group_memberships where role = 'athlete' and group_id in ($1, $2)`, [group, group2]);
      h.check("nobody who was already a client was removed", r.rows?.[0]?.n === 16, JSON.stringify(r));

      // a self-join is told nothing about the coach's plan
      await h.as(extra);
      r = await tryQ(db, `insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [group, extra]);
      await h.asSuper();
      h.check("a person joining on their own gets a neutral message (or is stopped by their own rules), never the coach's plan", !/Subscribe|free plan/.test(r.error ?? ""), r.error);

      // ---- who is not on the free plan
      await db.query(`insert into public.organization_billing (organization_id, billing_exempt) values ($1, true) on conflict (organization_id) do update set billing_exempt = true`, [org]);
      r = await addAthlete(group, extra);
      h.check("a founding (exempt) organization is never held to it", !r.error, r.error);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [group, extra]);
      await db.query(`update public.organization_billing set billing_exempt = false, subscription_status = 'active' where organization_id = $1`, [org]);
      r = await addAthlete(group, extra);
      h.check("nor an organization with an active plan", !r.error, r.error);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [group, extra]);
      await db.query(`update public.organization_billing set subscription_status = null where organization_id = $1`, [org]);
      await db.query(`update public.organizations set created_at = now() where id = $1`, [org]);
      r = await addAthlete(group, extra);
      h.check("nor one still inside its trial", !r.error, r.error);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [group, extra]);

      // ---- a coach already past 15 keeps every client and simply cannot add
      await makeOld(org);
      await setSwitch(false);
      for (let i = 0; i < 3; i++) {
        const c = await h.user("FT Over " + i);
        await addAthlete(group, c);
      }
      await setSwitch(true);
      const before = (await db.query(`select count(*)::int as n from public.group_memberships where group_id = $1 and role = 'athlete'`, [group])).rows[0].n;
      r = await addAthlete(group, extra);
      h.check("an organization already past 15 cannot add another", /up to 15 clients/.test(r.error ?? ""), r.error);
      h.check("and every client it had is still there (" + before + ")", before === 18);
      await setSwitch(false);
    },
  },
};
