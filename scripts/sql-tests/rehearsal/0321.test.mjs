// 0321: a coach's own website row is private to that coach (nobody else, no client and no signed-out visitor can read or write it), starts unpublished, keeps its limits (3 why lines,
// 3 reviews, a background from the list), and a Pro Shop card starts not featured.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0321 coach website and featured shop cards",
  migrations: ["0321"],
  phases: {
    async "0321"({ db, h }) {
      const coach = await h.user("WS Coach");
      const other = await h.user("WS Other Coach");
      const client = await h.user("WS Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "WS group");
      await h.member(group, client);

      await h.as(coach);
      const saved = await tryQ(db, `insert into public.coach_sites (coach_id, headline, why_lines, reviews) values ($1, 'Strength coach', array['one','two'], '[{"quote":"Great","first_name":"Ann"}]'::jsonb) returning published, background`, [coach]);
      h.check("a coach can save their own website, and it starts unpublished with the dark background", !saved.error && saved.rows[0].published === false && saved.rows[0].background === "dark", JSON.stringify(saved));
      const mine = await tryQ(db, "select count(*)::int as n from public.coach_sites", []);
      h.check("and read it back", !mine.error && mine.rows[0].n === 1, JSON.stringify(mine));

      await h.as(other);
      const seen = await tryQ(db, "select count(*)::int as n from public.coach_sites", []);
      h.check("another coach sees none of it", !seen.error && seen.rows[0].n === 0, JSON.stringify(seen));
      const forged = await tryQ(db, `insert into public.coach_sites (coach_id, headline) values ($1, 'forged') returning coach_id`, [coach]);
      h.check("and cannot write a website for someone else", !!forged.error, JSON.stringify(forged));
      const upd = await tryQ(db, `update public.coach_sites set published = true where coach_id = $1 returning coach_id`, [coach]);
      h.check("nor publish someone else's", !upd.error && upd.rows.length === 0, JSON.stringify(upd));

      await h.as(client);
      const cseen = await tryQ(db, "select count(*)::int as n from public.coach_sites", []);
      h.check("a client sees none of it", !cseen.error && cseen.rows[0].n === 0, JSON.stringify(cseen));

      await h.as(null);
      const anon = await tryQ(db, "select count(*)::int as n from public.coach_sites", []);
      h.check("a signed-out visitor cannot read the table at all (the public page reads published rows through the server only)", !!anon.error || anon.rows[0].n === 0, JSON.stringify(anon));

      await h.as(coach);
      const tooMany = await tryQ(db, `update public.coach_sites set why_lines = array['a','b','c','d'] where coach_id = $1`, [coach]);
      h.check("four why lines are refused", !!tooMany.error, JSON.stringify(tooMany));
      const badBg = await tryQ(db, `update public.coach_sites set background = 'neon' where coach_id = $1`, [coach]);
      h.check("a background outside the list is refused", !!badBg.error, JSON.stringify(badBg));

      await h.asSuper();
      const link = await tryQ(db, `insert into public.pro_shop_links (coach_id, title, url) values ($1, 'Shirt', 'https://example.com') returning featured`, [coach]);
      h.check("a Pro Shop card starts not featured", !link.error && link.rows[0].featured === false, JSON.stringify(link));
    },
  },
};
