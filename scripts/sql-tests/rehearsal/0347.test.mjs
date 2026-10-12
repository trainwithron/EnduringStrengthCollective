// 0347: the daily briefing is one row per coach, per day, per organization. Two organizations on one day are allowed; a second briefing for the same organization (or a second whole-coach row with no
// organization) on the same day is refused, as before.
export default {
  name: "0347 the briefing is made per organization",
  migrations: ["0347"],
  phases: {
    async "0347"({ db, h }) {
      const ownerA = await h.user("BR Owner A");
      const ownerB = await h.user("BR Owner B");
      const coach = await h.user("BR Coach");
      const orgA = await h.org(ownerA);
      const orgB = await h.org(ownerB);
      await h.asSuper();
      const add = (org, day) => db.query(`insert into public.coach_briefings (coach_id, briefing_date, organization_id) values ($1, $2, $3)`, [coach, day, org]);
      await add(orgA, "2026-10-12");
      await add(orgB, "2026-10-12");
      h.check("one coach can have a briefing for each organization on the same day", (await db.query(`select count(*)::int as n from public.coach_briefings where coach_id = $1`, [coach])).rows[0].n === 2);
      await h.expectError("a second briefing for the same organization and day", () => add(orgA, "2026-10-12"), /duplicate|unique/i);
      await add(null, "2026-10-12");
      await h.expectError("a second whole-coach briefing (no organization) on the same day", () => add(null, "2026-10-12"), /duplicate|unique/i);
      await add(orgA, "2026-10-13");
      h.check("the next day starts fresh", (await db.query(`select count(*)::int as n from public.coach_briefings where coach_id = $1 and briefing_date = '2026-10-13'`, [coach])).rows[0].n === 1);
    },
  },
};
