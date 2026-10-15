// 0376: the health screening line on a client's Overview. The coach's acknowledgement row (already private to the coach) now also holds how many flagged answers they had seen.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0376 Health screening acknowledged count",
  migrations: ["0376"],
  phases: {
    async "0376"({ db, h }) {
      const coach = await h.user("HS Coach");
      const coach2 = await h.user("HS Second Coach");
      const client = await h.user("HS Client");
      const org = await h.org(coach);
      await h.orgMember(org, coach2, "coach");
      const group = await h.group(org, coach, "team", "HS team");
      await h.member(group, client);

      await h.as(coach);
      const old = await tryQ(db, `insert into public.athlete_injury_flag_acknowledgements (coach_id, athlete_id) values ($1, $2) returning flagged_count`, [coach, client]);
      h.check("an acknowledgement made the old way has no count (counts as zero)", !old.error && old.rows[0].flagged_count === null);
      const ack = await tryQ(db, `insert into public.athlete_injury_flag_acknowledgements (coach_id, athlete_id, flagged_count) values ($1, $2, 2) on conflict (coach_id, athlete_id) do update set flagged_count = excluded.flagged_count, acknowledged_at = now() returning flagged_count`, [coach, client]);
      h.check("the coach can acknowledge two flagged answers" + (ack.error ? ": " + ack.error : ""), ack.rows?.[0]?.flagged_count === 2);
      const more = await tryQ(db, `update public.athlete_injury_flag_acknowledgements set flagged_count = 3 where coach_id = $1 and athlete_id = $2 returning flagged_count`, [coach, client]);
      h.check("and later acknowledge three", more.rows?.[0]?.flagged_count === 3);
      h.check("a coach cannot acknowledge as another coach", !!(await tryQ(db, `insert into public.athlete_injury_flag_acknowledgements (coach_id, athlete_id, flagged_count) values ($1, $2, 1)`, [coach2, client])).error);
      await h.as(coach2);
      h.check("another coach does not see it (it is private to the coach who made it)", (await db.query(`select count(*)::int as n from public.athlete_injury_flag_acknowledgements`)).rows[0].n === 0);
      await h.as(client);
      h.check("the client does not see it either", (await db.query(`select count(*)::int as n from public.athlete_injury_flag_acknowledgements`)).rows[0].n === 0);
    },
  },
};
