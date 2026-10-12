// 0339: a transformation card can only name the athlete's OWN progress photos and milestone, in a group they are a client of, and is never made for a client under 18.
export default {
  name: "0339 a transformation card only uses the athlete's own photos, milestone and group; never for under 18",
  migrations: ["0339"],
  phases: {
    async "0339"({ db, h }) {
      const coach = await h.user("AQ Coach");
      const ann = await h.user("AQ Ann");
      const bob = await h.user("AQ Bob");
      const kid = await h.user("AQ Kid");
      const org = await h.org(coach);
      const g1 = await h.group(org, coach, "team", "AQ team");
      const g2 = await h.group(org, coach, "team", "AQ other team");
      await h.member(g1, ann);
      await h.member(g1, bob);
      await h.member(g1, kid);

      await h.asSuper();
      const photo = async (who) => (await db.query(`insert into public.progress_photos (athlete_id, group_id, storage_path) values ($1, $2, $3) returning id`, [who, g1, `${who}/${crypto.randomUUID()}.jpg`])).rows[0].id;
      const milestone = async (who) => (await db.query(`insert into public.transformation_milestones (athlete_id, group_id, threshold_lbs, starting_weight, current_weight) values ($1, $2, 10, 200, 190) returning id`, [who, g1])).rows[0].id;
      const annPhoto = await photo(ann);
      const bobPhoto = await photo(bob);
      const annMs = await milestone(ann);
      const bobMs = await milestone(bob);
      const kidMs = await milestone(kid);
      await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, current_date - interval '15 years')`, [kid, g1]);
      const kidPhoto = await photo(kid);

      const card = (who, grp, ms, before, after) =>
        db.query(
          `insert into public.transformation_cards (athlete_id, group_id, milestone_id, starting_weight, current_weight, window_start_date, window_end_date, before_photo_id, after_photo_id)
           values ($1, $2, $3, 200, 190, current_date - 30, current_date, $4, $5) returning id`,
          [who, grp, ms, before, after]
        );

      await h.as(ann);
      const ok = await card(ann, g1, annMs, annPhoto, annPhoto);
      h.check("an athlete can make a card from their own photos and milestone in their own group", ok.rows.length === 1);
      await h.expectError("a card naming someone else's photo is refused", () => card(ann, g1, annMs, bobPhoto, null), /row-level security/i);
      await h.expectError("...as the after photo too", () => card(ann, g1, annMs, null, bobPhoto), /row-level security/i);
      await h.expectError("a card on someone else's milestone is refused", () => card(ann, g1, bobMs, null, null), /row-level security/i);
      await h.expectError("a card in a group the athlete is not a client of is refused", () => card(ann, g2, annMs, null, null), /row-level security/i);
      await h.expectError("a card for someone else is refused", () => card(bob, g1, bobMs, null, null), /row-level security/i);

      const edit = await h.rows(`update public.transformation_cards set humor_enabled = false where id = $1 returning id`, [ok.rows[0].id]);
      h.check("they can still edit their own card", edit.length === 1);
      await h.expectError("they cannot point it at someone else's photo later", () => db.query(`update public.transformation_cards set before_photo_id = $1 where id = $2`, [bobPhoto, ok.rows[0].id]), /row-level security/i);
      const gone = await h.rows(`delete from public.transformation_cards where id = $1 returning id`, [ok.rows[0].id]);
      h.check("they can delete their own card", gone.length === 1);

      await h.as(kid);
      await h.expectError("a client under 18 cannot make a card at all", () => card(kid, g1, kidMs, kidPhoto, null), /row-level security/i);
    },
  },
};
