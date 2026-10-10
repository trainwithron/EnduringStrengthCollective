// 0330: only a real coach (someone who coaches a group) can create or change a public booking page or a public website.
export default {
  name: "0330 only a real coach can have a public page",
  migrations: ["0330"],
  phases: {
    async "0330"({ db, h }) {
      const coach = await h.user("PC Coach");
      const client = await h.user("PC Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "PC group");
      await h.member(group, client);

      await h.as(coach);
      await db.query(`insert into public.coach_booking_pages (coach_id, slug) values ($1, 'pc-coach')`, [coach]);
      await db.query(`insert into public.coach_sites (coach_id) values ($1)`, [coach]);
      const mine = await h.one(`select (select count(*) from public.coach_booking_pages)::int as p, (select count(*) from public.coach_sites)::int as s`);
      h.check("a coach can create their booking page and website", mine.p === 1 && mine.s === 1, JSON.stringify(mine));
      await db.query(`update public.coach_sites set headline = 'Strong' where coach_id = $1`, [coach]);
      await db.query(`update public.coach_booking_pages set enabled = true where coach_id = $1`, [coach]);
      h.check("...and change them", (await h.one(`select headline from public.coach_sites where coach_id = $1`, [coach])).headline === "Strong");

      await h.as(client);
      await h.expectError("an account that coaches no group cannot create a booking page", () => db.query(`insert into public.coach_booking_pages (coach_id, slug) values ($1, 'pc-client')`, [client]), /row-level security|violates/i);
      await h.expectError("...or a website", () => db.query(`insert into public.coach_sites (coach_id) values ($1)`, [client]), /row-level security|violates/i);
      const seen = await h.one(`select (select count(*) from public.coach_booking_pages)::int as p, (select count(*) from public.coach_sites)::int as s`);
      h.check("a client does not see another person's page rows", seen.p === 0 && seen.s === 0, JSON.stringify(seen));

      await h.as(coach);
      await h.expectError("a coach cannot create a page in someone else's name", () => db.query(`insert into public.coach_sites (coach_id) values ($1)`, [client]), /row-level security|violates/i);

      // A coach who stops coaching can still read and remove their own page; only changes are refused.
      await h.asSuper();
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [group, coach]);
      await h.as(coach);
      const still = await h.one(`select count(*)::int as n from public.coach_sites where coach_id = $1`, [coach]);
      h.check("a former coach can still read their own page", still.n === 1);
      await h.expectError("...but not change it", async () => {
        const r = await db.query(`update public.coach_sites set headline = 'Changed' where coach_id = $1 returning coach_id`, [coach]);
        if (r.rows.length === 0) throw new Error("row-level security: no row changed");
      }, /row-level security|violates|no row changed/i);
      const del = await db.query(`delete from public.coach_sites where coach_id = $1 returning coach_id`, [coach]);
      h.check("...and can remove it", del.rows.length === 1);
    },
  },
};
