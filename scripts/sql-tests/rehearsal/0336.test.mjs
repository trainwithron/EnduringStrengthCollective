// 0336: the "What do you call your people?" card is asked once, for good. The answer is a date on the coach's own profile. Every coach who exists when this is applied counts as having
// answered (nobody already here is asked again); a coach who joins later starts empty. Only the person themselves can record it.
export default {
  name: "0336 the what-do-you-call-your-people card is asked once",
  migrations: ["0336"],
  phases: {
    async "0336"({ db, h }) {
      const coach = await h.user("TM Coach");
      const athlete = await h.user("TM Athlete");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "TM team");
      await h.member(group, athlete);

      await h.asSuper();
      // The migration's backfill, run on this scene (the migration ran before these people existed).
      await db.query(`update public.profiles set terminology_asked_at = now() where terminology_asked_at is null and id in (select gm.profile_id from public.group_memberships gm where gm.role = 'coach')`);
      const rows = await h.rows(`select id, terminology_asked_at is not null as asked from public.profiles where id in ($1, $2)`, [coach, athlete]);
      const by = Object.fromEntries(rows.map((r) => [r.id, r.asked]));
      h.check("the backfill marks a coach as answered", by[coach] === true);
      h.check("...and not an athlete (who never sees the card)", by[athlete] === false);

      const lateCoach = await h.user("TM Late Coach");
      await h.member(group, lateCoach, "coach");
      const late = await h.one(`select terminology_asked_at is null as empty from public.profiles where id = $1`, [lateCoach]);
      h.check("a coach who joins after starts empty, so is asked once", late.empty === true);

      await h.as(lateCoach);
      const mine = await h.rows(`update public.profiles set terminology_asked_at = now() where id = $1 returning terminology_asked_at`, [lateCoach]);
      h.check("a coach can record their own answer", mine.length === 1 && mine[0].terminology_asked_at !== null);
      await h.as(athlete);
      const theirs = await h.rows(`update public.profiles set terminology_asked_at = null where id = $1 returning id`, [lateCoach]);
      h.check("nobody else can change it", theirs.length === 0);
      await h.asSuper();
      const kept = await h.one(`select terminology_asked_at is not null as asked from public.profiles where id = $1`, [lateCoach]);
      h.check("so the answer stays recorded", kept.asked === true);
    },
  },
};
