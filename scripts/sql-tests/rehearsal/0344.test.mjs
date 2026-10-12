// 0344: a coach can still tidy up an existing row of someone who has since left the group; a first row about someone who never belonged is still refused.
export default {
  name: "0344 the athlete-in-group rule keeps existing rows editable after the person left",
  migrations: ["0344"],
  phases: {
    async "0344"({ db, h }) {
      const coach = await h.user("AV Coach");
      const left = await h.user("AV Left");
      const stranger = await h.user("AV Stranger");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "AV team");
      await h.member(g, left);

      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 3)`, [left, g]);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [g, left]);

      await h.as(coach);
      const upsert = (who, n) =>
        db.query(
          `insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, $3)
           on conflict (athlete_id, group_id) do update set balance = excluded.balance returning balance`,
          [who, g, n]
        );
      const r = await upsert(left, 5);
      h.check("a coach can still settle the credits of someone who left (the row already existed)", r.rows.length === 1 && r.rows[0].balance === 5);
      await h.expectError("a first row about someone who never belonged to the group is still refused", () => upsert(stranger, 5), /not a member of this group/i);
    },
  },
};
