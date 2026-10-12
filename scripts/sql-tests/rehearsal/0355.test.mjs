// 0355: coach assessments are the coach's working records. The coach of the client's group reads and writes them; another coach, the client, the organization's owner and an anonymous caller read none.
export default {
  name: "0355 coach assessments are private to the coaches of the group",
  migrations: ["0355"],
  phases: {
    async "0355"({ db, h }) {
      const owner = await h.user("CA Owner");
      const coach = await h.user("CA Coach");
      const otherCoach = await h.user("CA Other Coach");
      const client = await h.user("CA Client");
      const org = await h.org(owner);
      await h.orgMember(org, coach, "coach");
      await h.orgMember(org, otherCoach, "coach");
      const g = await h.group(org, coach, "team", "CA team");
      const g2 = await h.group(org, otherCoach, "team", "CA other team");
      await h.member(g, client);

      await h.as(coach);
      await db.query(`insert into public.client_assessments (athlete_id, group_id, title, notes, measurements, created_by) values ($1, $2, 'Movement screen', 'Left ankle limited.', 'Dorsiflexion 8 cm', $3)`, [client, g, coach]);
      h.check("the coach of the group can add an assessment", (await db.query(`select count(*)::int as n from public.client_assessments where athlete_id = $1`, [client])).rows[0].n === 1);
      await h.expectError("a coach cannot file an assessment for someone who is not in the group", () => db.query(`insert into public.client_assessments (athlete_id, group_id, title, created_by) values ($1, $2, 'x', $3)`, [owner, g, coach]), /row-level security|violates|policy/i);

      for (const [label, who] of [["another coach", otherCoach], ["the client", client], ["the organization's owner", owner], ["an anonymous caller", null]]) {
        await h.as(who);
        let n = 0;
        try {
          n = (await db.query(`select count(*)::int as n from public.client_assessments where athlete_id = $1`, [client])).rows[0].n;
        } catch {
          n = 0;
        }
        h.check(`${label} reads none of it`, n === 0);
      }
    },
  },
};
