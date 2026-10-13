// 0364: a group session (class) belongs to one organization. A coach who runs classes in two organizations: a client of the coach in organization A sees and can join only A's classes, a client in B only B's.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0364 group sessions belong to one organization",
  migrations: ["0364"],
  phases: {
    async "0364"({ db, h }) {
      const ownerA = await h.user("CL Owner A");
      const ownerB = await h.user("CL Owner B");
      const coach = await h.user("CL Coach");
      const clientA = await h.user("CL Client A");
      const clientB = await h.user("CL Client B");
      const orgA = await h.org(ownerA);
      const orgB = await h.org(ownerB);
      await h.orgMember(orgA, coach, "coach");
      await h.orgMember(orgB, coach, "coach");
      const gA = await h.group(orgA, coach, "team", "CL team A");
      const gB = await h.group(orgB, coach, "team", "CL team B");
      await h.member(gA, clientA);
      await h.member(gB, clientB);

      await h.as(coach);
      const start = new Date(Date.now() + 3 * 86400000);
      const end = new Date(start.getTime() + 3600000);
      const a = await db.query(`select public.create_group_session($1, 'CL class A', $2, $3, 8) as id`, [gA, start.toISOString(), end.toISOString()]);
      const start2 = new Date(start.getTime() + 2 * 3600000);
      const b = await db.query(`select public.create_group_session($1, 'CL class B', $2, $3, 8) as id`, [gB, start2.toISOString(), new Date(start2.getTime() + 3600000).toISOString()]);
      const idA = a.rows[0].id;
      const idB = b.rows[0].id;
      await h.asSuper();
      const orgs = (await db.query(`select id, organization_id from public.group_sessions where id in ($1, $2)`, [idA, idB])).rows;
      h.check("each class is made in the organization of the group it was scheduled in", orgs.find((r) => r.id === idA)?.organization_id === orgA && orgs.find((r) => r.id === idB)?.organization_id === orgB);

      await h.as(clientA);
      const seenA = (await db.query(`select title from public.group_sessions order by title`)).rows.map((r) => r.title);
      h.check("a member of organization A sees A's class and not B's", JSON.stringify(seenA) === JSON.stringify(["CL class A"]));
      const countsA = (await db.query(`select session_id from public.group_session_counts(array[$1::uuid, $2::uuid])`, [idA, idB])).rows.map((r) => r.session_id);
      h.check("the spot counts answer for A's class only", countsA.length === 1 && countsA[0] === idA);
      const joinB = await msg(db, `select public.join_group_session($1, $2)`, [idB, clientA]);
      h.check("a member of A cannot join B's class (" + joinB + ")", /not a training client of this coach/.test(joinB));
      const joinA = await msg(db, `select public.join_group_session($1, $2)`, [idA, clientA]);
      h.check("...but is let through to A's class (it stops only at having no session credits: " + joinA + ")", /no session credits remaining/.test(joinA));

      await h.as(clientB);
      const seenB = (await db.query(`select title from public.group_sessions order by title`)).rows.map((r) => r.title);
      h.check("a member of organization B sees B's class and not A's", JSON.stringify(seenB) === JSON.stringify(["CL class B"]));

      await h.as(coach);
      const seenCoach = (await db.query(`select count(*)::int as n from public.group_sessions where id in ($1, $2)`, [idA, idB])).rows[0].n;
      h.check("the coach sees both of their classes", seenCoach === 2);

      await h.as(ownerB);
      const seenOwnerB = (await db.query(`select count(*)::int as n from public.group_sessions where id in ($1, $2)`, [idA, idB])).rows[0].n;
      h.check("another organization's owner sees neither", seenOwnerB === 0);
    },
  },
};
