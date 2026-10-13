// 0356: the review request. A client can send ONE short quote to a coach of their own group; only that coach (and the group's coaches) see it; another client cannot see or send for someone else; the
// "card shown" record is the client's own and there is one per client and group.
export default {
  name: "0356 review request and client quotes",
  migrations: ["0356"],
  phases: {
    async "0356"({ db, h }) {
      const owner = await h.user("RQ Owner");
      const coach = await h.user("RQ Coach");
      const otherCoach = await h.user("RQ Other Coach");
      const client = await h.user("RQ Client");
      const other = await h.user("RQ Other Client");
      const minor = await h.user("RQ Young Client");
      const org = await h.org(owner);
      await h.orgMember(org, coach, "coach");
      await h.orgMember(org, otherCoach, "coach");
      const g = await h.group(org, coach, "team", "RQ team");
      const g2 = await h.group(org, otherCoach, "team", "RQ other team");
      await h.member(g, client);
      await h.member(g, other);
      await h.member(g, minor);
      await h.member(g2, other);

      await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, (current_date - interval '15 years')::date)`, [minor, g]);
      await h.as(client);
      await db.query(`insert into public.client_quotes (athlete_id, group_id, coach_id, body, first_name, share_publicly) values ($1, $2, $3, 'Best coach I have had.', 'Sam', true)`, [client, g, coach]);
      h.check("a client can send a short quote to their coach", (await db.query(`select count(*)::int as n from public.client_quotes where athlete_id = $1`, [client])).rows[0].n === 1);
      await h.expectError("a client cannot send a quote as someone else", () => db.query(`insert into public.client_quotes (athlete_id, group_id, coach_id, body) values ($1, $2, $3, 'x')`, [other, g, coach]), /row-level security|violates|policy/i);
      await h.expectError("...nor to a coach who does not coach their group", () => db.query(`insert into public.client_quotes (athlete_id, group_id, coach_id, body) values ($1, $2, $3, 'x')`, [client, g, otherCoach]), /row-level security|violates|policy/i);
      await h.expectError("...nor a quote that is already approved", () => db.query(`insert into public.client_quotes (athlete_id, group_id, coach_id, body, status) values ($1, $2, $3, 'x', 'used')`, [client, g, coach]), /row-level security|violates|policy|check/i);
      await h.expectError("a client cannot change a quote after sending it", async () => {
        const r = await db.query(`update public.client_quotes set status = 'used' where athlete_id = $1 returning 1`, [client]);
        if (r.rowCount === 0) throw new Error("no row changed");
      }, /row-level security|violates|permission|no row changed/i);

      await h.as(coach);
      h.check("the coach sees it", (await db.query(`select count(*)::int as n from public.client_quotes where group_id = $1`, [g])).rows[0].n === 1);
      await db.query(`update public.client_quotes set status = 'used' where group_id = $1`, [g]);
      h.check("...and can say what became of it", (await db.query(`select status from public.client_quotes where body = 'Best coach I have had.'`)).rows[0].status === "used");
      await h.as(otherCoach);
      h.check("a coach of another group sees none of it", (await db.query(`select count(*)::int as n from public.client_quotes`)).rows[0].n === 0);
      await h.as(other);
      h.check("another client sees none of it", (await db.query(`select count(*)::int as n from public.client_quotes where group_id = $1`, [g])).rows[0].n === 0);

      await h.as(minor);
      await h.expectError("a client whose date of birth makes them under 18 cannot leave a quote, shared or not", () => db.query(`insert into public.client_quotes (athlete_id, group_id, coach_id, body, share_publicly) values ($1, $2, $3, 'x', true)`, [minor, g, coach]), /under 18/i);
      await h.expectError("...not even privately", () => db.query(`insert into public.client_quotes (athlete_id, group_id, coach_id, body) values ($1, $2, $3, 'x')`, [minor, g, coach]), /under 18/i);
      await h.as(client);
      await db.query(`insert into public.review_prompts_shown (athlete_id, group_id, outcome) values ($1, $2, 'not_now')`, [client, g]);
      await h.expectError("the card is recorded once per client and group", () => db.query(`insert into public.review_prompts_shown (athlete_id, group_id, outcome) values ($1, $2, 'quote')`, [client, g]), /duplicate|unique/i);
      await h.expectError("a client cannot record it for someone else", () => db.query(`insert into public.review_prompts_shown (athlete_id, group_id) values ($1, $2)`, [other, g]), /row-level security|violates|policy/i);
    },
  },
};
