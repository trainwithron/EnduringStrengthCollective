// 0368: the one product shelf. Existing rows keep showing exactly as before (everyone), "one group" needs a group, a bad audience is refused, and the public page keeps the cards that are featured today.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0368 shelf placement and audience",
  migrations: ["0368"],
  phases: {
    async "0368"({ db, h }) {
      const coach = await h.user("SH Coach");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "SH team");
      await h.asSuper();

      const pkg = (await db.query(`insert into public.coach_packages (coach_id, group_id, name, sessions_per_week, billing_type, sessions_granted, rate_cents) values ($1, $2, 'SH pack', 2, 'one_time', 4, 5000) returning id`, [coach, group])).rows[0].id;
      const row = (await db.query(`select show_on_home, show_in_pro_shop, audience, audience_group_id, buyer_joins_space from public.coach_packages where id = $1`, [pkg])).rows[0];
      h.check("a package keeps showing as before: not on Home, not in the Pro Shop, to everyone, buyer joins the space", row.show_on_home === false && row.show_in_pro_shop === false && row.audience === "everyone" && row.audience_group_id === null && row.buyer_joins_space === true);

      await db.query(`update public.coach_packages set audience = 'one_group', audience_group_id = $2 where id = $1`, [pkg, group]);
      h.check("a package can be limited to one group", (await db.query(`select audience from public.coach_packages where id = $1`, [pkg])).rows[0].audience === "one_group");
      h.check("one group without a group is refused", (await msg(db, `update public.coach_packages set audience = 'one_group', audience_group_id = null where id = $1`, [pkg])).includes("audience_check"));
      h.check("an unknown audience is refused", (await msg(db, `update public.coach_packages set audience = 'nobody' where id = $1`, [pkg])).includes("audience_check"));
      await db.query(`update public.coach_packages set audience = 'not_one_on_one', audience_group_id = null where id = $1`, [pkg]);

      const link = (await db.query(`insert into public.pro_shop_links (coach_id, title, url, featured) values ($1, 'SH merch', 'https://example.com/m', true) returning id`, [coach])).rows[0].id;
      const l = (await db.query(`select show_on_public, audience from public.pro_shop_links where id = $1`, [link])).rows[0];
      h.check("a new card defaults to not on the public page and to everyone", l.show_on_public === false && l.audience === "everyone");
      // the migration's own last step, run again on this featured card: public pages keep their featured cards
      await db.query(`update public.pro_shop_links set show_on_public = true where featured = true and show_on_public = false`);
      h.check("a featured card is also on the public page, so no public page changes", (await db.query(`select show_on_public from public.pro_shop_links where id = $1`, [link])).rows[0].show_on_public === true);
      h.check("a link card cannot have an unknown audience either", (await msg(db, `update public.pro_shop_links set audience = 'x' where id = $1`, [link])).includes("audience_check"));
    },
  },
};
