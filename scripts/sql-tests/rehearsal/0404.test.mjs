// 0404: the narrow reads. A member of a group gets names, photos, roles and positions of that group and nothing else; anyone else gets nothing.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0404 Athlete narrow reads",
  migrations: ["0404"],
  phases: {
    async "0404"({ db, h }) {
      const coach = await h.user("NR Coach");
      const ann = await h.user("NR Ann");
      const bo = await h.user("NR Bo");
      const outsider = await h.user("NR Outsider");
      const admin = await h.user("NR Unseated Admin");
      const hidden = await h.user("NR Private Client");
      const org = await h.org(coach, "NR Gym");
      const g = await h.group(org, coach, "team", "NR Team");
      const other = await h.group(org, coach, "team", "NR Other Team");
      await h.member(g, ann);
      await h.member(g, bo);
      await h.member(other, outsider);
      await h.member(g, hidden);
      await h.orgMember(org, admin, "admin");
      await h.asSuper();
      const pos = (await db.query(`insert into public.group_positions (group_id, name, sort_order) values ($1, 'Linemen', 2) returning id`, [g])).rows[0].id;
      await db.query(`update public.group_memberships set position_id = $1, client_tier = 'online', training_level = 'advanced' where group_id = $2 and profile_id = $3`, [pos, g, ann]);

      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [g, hidden]);

      const asRows = async (who, sql, params) => { await h.as(who); const r = await tryQ(db, sql, params); await h.asSuper(); return r; };

      let r = await asRows(ann, `select * from public.group_member_names($1)`, [g]);
      h.check("a member gets everyone in the group", r.rows?.length === 4, JSON.stringify(r));
      h.check("and only id, name, photo and role", Object.keys(r.rows?.[0] ?? {}).sort().join() === "avatar_url,full_name,profile_id,role", Object.keys(r.rows?.[0] ?? {}).join());
      h.check("their roles are right", r.rows?.filter((x) => x.role === "athlete").length === 3 && r.rows?.filter((x) => x.role === "coach").length === 1);

      r = await asRows(outsider, `select * from public.group_member_names($1)`, [g]);
      h.check("someone in another group gets nothing", !r.error && r.rows.length === 0, JSON.stringify(r));
      await h.as(null);
      r = await tryQ(db, `select * from public.group_member_names($1)`, [g]);
      h.check("a signed-out caller gets nothing or is refused", !!r.error || r.rows.length === 0, JSON.stringify(r));
      await h.asSuper();

      r = await asRows(bo, `select * from public.group_position_roster($1)`, [g]);
      h.check("a member gets the athletes (not the coach) with their position", r.rows?.length === 3 && r.rows.find((x) => x.profile_id === ann)?.position_name === "Linemen", JSON.stringify(r));
      h.check("and only name, how they share, and position", Object.keys(r.rows?.[0] ?? {}).sort().join() === "feed_broadcast_level,full_name,position_id,position_name,position_sort_order,profile_id", Object.keys(r.rows?.[0] ?? {}).join());
      h.check("no tier, level or privacy setting comes with it", !JSON.stringify(r.rows).includes("online") && !JSON.stringify(r.rows).includes("advanced"));
      r = await asRows(outsider, `select * from public.group_position_roster($1)`, [g]);
      h.check("someone in another group gets nothing", !r.error && r.rows.length === 0, JSON.stringify(r));
      r = await asRows(coach, `select * from public.group_position_roster($1)`, [g]);
      h.check("the coach gets the same", r.rows?.length === 3);

      // an owner or admin of the organization who holds no seat in the group: the same rule as the existing policy (a client private from the organization stays out of sight)
      r = await asRows(admin, `select * from public.group_member_names($1)`, [g]);
      h.check("an organization admin with no seat in the group gets the people in it", r.rows?.length === 3 && !r.rows.some((x) => x.profile_id === hidden), JSON.stringify(r));
      r = await asRows(admin, `select * from public.group_position_roster($1)`, [g]);
      h.check("and the team's athletes, without the client who is private from the organization", r.rows?.length === 2 && !r.rows.some((x) => x.profile_id === hidden), JSON.stringify(r));
      r = await asRows(outsider, `select * from public.group_member_names($1)`, [g]);
      h.check("someone from another group still gets nothing", !r.error && r.rows.length === 0, JSON.stringify(r));
    },
  },
};
