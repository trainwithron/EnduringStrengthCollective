// 0408: "No automatic nutrition suggestions" is a coach-only note per client. The client cannot read it, another coach cannot see or change it, and it is not tied to the membership.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0408 Nutrition suggestions switch",
  migrations: ["0408"],
  phases: {
    async "0408"({ db, h }) {
      const coach = await h.user("NF Coach");
      const other = await h.user("NF Other Coach");
      const client = await h.user("NF Client");
      const org = await h.org(coach);
      await h.orgMember(org, other, "coach");
      const group = await h.group(org, coach, "team", "NF team");
      const otherGroup = await h.group(org, other, "team", "NF other team");
      await h.member(group, client);

      await h.as(coach);
      const set = await db.query(`insert into public.client_nutrition_flags (group_id, profile_id, auto_off, set_by) values ($1, $2, true, $3) returning auto_off`, [group, client, coach]);
      h.check("a coach can switch automatic suggestions off for their client", set.rows.length === 1 && set.rows[0].auto_off === true);
      const again = await db.query(`insert into public.client_nutrition_flags (group_id, profile_id, auto_off, set_by) values ($1, $2, false, $3) on conflict (group_id, profile_id) do update set auto_off = excluded.auto_off returning auto_off`, [group, client, coach]);
      h.check("and back on, still one row per client", again.rows[0].auto_off === false && (await db.query(`select count(*)::int as n from public.client_nutrition_flags where profile_id = $1`, [client])).rows[0].n === 1);
      await db.query(`update public.client_nutrition_flags set auto_off = true where group_id = $1 and profile_id = $2`, [group, client]);
      h.check("a coach cannot set it for a group they do not coach", (await msg(db, `insert into public.client_nutrition_flags (group_id, profile_id, auto_off) values ($1, $2, true)`, [otherGroup, client])).length > 0);

      await h.as(other);
      h.check("another coach sees none of it", (await db.query(`select count(*)::int as n from public.client_nutrition_flags`)).rows[0].n === 0);
      const theirs = await db.query(`update public.client_nutrition_flags set auto_off = false where group_id = $1 and profile_id = $2 returning 1`, [group, client]);
      h.check("another coach cannot change it", theirs.rows.length === 0);

      await h.as(client);
      h.check("the client never reads it", (await db.query(`select count(*)::int as n from public.client_nutrition_flags`)).rows[0].n === 0);
      const own = await db.query(`update public.client_nutrition_flags set auto_off = false where group_id = $1 and profile_id = $2 returning 1`, [group, client]);
      h.check("and cannot change it", own.rows.length === 0);
      h.check("the client cannot add one for themselves", (await msg(db, `insert into public.client_nutrition_flags (group_id, profile_id, auto_off) values ($1, $2, false) on conflict do nothing`, [group, client])).length > 0);

      await h.asSuper();
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [group, client]);
      h.check("it survives the client being taken out of the group (and so is there when they are put back)", (await db.query(`select auto_off from public.client_nutrition_flags where group_id = $1 and profile_id = $2`, [group, client])).rows[0]?.auto_off === true);
    },
  },
};
