// 0363: smaller goals. The client adds one for themselves, a coach adds one for a client of their group; nobody else adds or reads; and signed-in people cannot change or delete a row (only the server does).
export default {
  name: "0363 smaller goals: add and read by the client and their coach only, no direct change",
  migrations: ["0363"],
  phases: {
    async "0363"({ db, h }) {
      const owner = await h.user("SG Owner");
      const coach = await h.user("SG Coach");
      const otherCoach = await h.user("SG Other Coach");
      const client = await h.user("SG Client");
      const stranger = await h.user("SG Stranger");
      const org = await h.org(owner);
      await h.orgMember(org, coach, "coach");
      await h.orgMember(org, otherCoach, "coach");
      const g = await h.group(org, coach, "team", "SG team");
      const g2 = await h.group(org, otherCoach, "team", "SG other team");
      await h.member(g, client);

      await h.as(client);
      const mine = await db.query(`insert into public.client_sub_goals (athlete_id, group_id, title, proposed_by) values ($1, $2, 'Deadlift 315', $1) returning id`, [client, g]);
      h.check("a client can add a smaller goal for themselves", mine.rows.length === 1);
      await h.expectError("a client cannot add one as if their coach had", () => db.query(`insert into public.client_sub_goals (athlete_id, group_id, title, proposed_by) values ($1, $2, 'x', $3)`, [client, g, coach]), /row-level security/);
      await h.expectError("a client cannot add one already agreed", () => db.query(`insert into public.client_sub_goals (athlete_id, group_id, title, proposed_by, status) values ($1, $2, 'x', $1, 'agreed')`, [client, g]), /row-level security/);

      await h.as(coach);
      const theirs = await db.query(`insert into public.client_sub_goals (athlete_id, group_id, title, proposed_by) values ($1, $2, '5K under 25:00', $3) returning id`, [client, g, coach]);
      h.check("a coach can add a smaller goal for a client of their group", theirs.rows.length === 1);
      h.check("the coach reads both", (await db.query(`select count(*)::int as n from public.client_sub_goals where athlete_id = $1`, [client])).rows[0].n === 2);
      await h.expectError("a coach cannot add one for someone who is not in their group", () => db.query(`insert into public.client_sub_goals (athlete_id, group_id, title, proposed_by) values ($1, $2, 'x', $3)`, [stranger, g, coach]), /row-level security/);

      await h.as(client);
      h.check("the client reads both", (await db.query(`select count(*)::int as n from public.client_sub_goals where athlete_id = $1`, [client])).rows[0].n === 2);

      for (const [label, who] of [["another coach", otherCoach], ["a stranger", stranger], ["an anonymous caller", null]]) {
        await h.as(who);
        let n = 0;
        try {
          n = (await db.query(`select count(*)::int as n from public.client_sub_goals`)).rows[0].n;
        } catch {
          n = 0;
        }
        h.check(`${label} reads none`, n === 0);
      }
      await h.as(otherCoach);
      await h.expectError("another coach cannot add one for this client", () => db.query(`insert into public.client_sub_goals (athlete_id, group_id, title, proposed_by) values ($1, $2, 'x', $3)`, [client, g, otherCoach]), /row-level security/);

      for (const [label, who] of [["the client", client], ["the coach", coach]]) {
        await h.as(who);
        const changed = await db.query(`update public.client_sub_goals set status = 'agreed' where athlete_id = $1`, [client]).then((r) => r.rowCount ?? 0, () => 0);
        h.check(`${label} cannot change a smaller goal directly (only the server does)`, changed === 0);
        const removed = await db.query(`delete from public.client_sub_goals where athlete_id = $1`, [client]).then((r) => r.rowCount ?? 0, () => 0);
        h.check(`${label} cannot delete one`, removed === 0);
      }
    },
  },
};
