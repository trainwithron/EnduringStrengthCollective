// 0350: a coach's Pro Shop links (and the other five lists) belong to an organization. A coach in two organizations files a link in either; a client sees only the organization they are a client in; a row
// saved without an organization goes to the coach's usual one (the organization with the most clients).
export default {
  name: "0350 the coach's business lists are per organization",
  migrations: ["0350"],
  phases: {
    async "0350"({ db, h }) {
      const ownerA = await h.user("PO Owner A");
      const ownerB = await h.user("PO Owner B");
      const ownerC = await h.user("PO Owner C");
      const coach = await h.user("PO Coach Both");
      const cA = await h.user("PO Client A");
      const cB1 = await h.user("PO Client B1");
      const cB2 = await h.user("PO Client B2");
      const orgA = await h.org(ownerA);
      const orgB = await h.org(ownerB);
      const orgC = await h.org(ownerC);
      await h.orgMember(orgA, coach, "coach");
      await h.orgMember(orgB, coach, "coach");
      const gA = await h.group(orgA, coach, "team", "PO team A");
      const gB = await h.group(orgB, coach, "team", "PO team B");
      await h.member(gA, cA);
      await h.member(gB, cB1);
      await h.member(gB, cB2);

      await h.as(coach);
      const link = (title, org) =>
        org === undefined
          ? db.query(`insert into public.pro_shop_links (coach_id, title, url) values ($1, $2, 'https://example.com') returning organization_id`, [coach, title])
          : db.query(`insert into public.pro_shop_links (coach_id, title, url, organization_id) values ($1, $2, 'https://example.com', $3) returning organization_id`, [coach, title, org]);
      const usual = (await link("PO unfiled")).rows[0].organization_id;
      h.check("a link saved without an organization goes to the coach's usual one (the one with the most clients)", usual === orgB);
      await link("PO in A", orgA);
      await h.expectError("a coach cannot file a link under an organization they do not belong to", () => link("PO in C", orgC), /row-level security|violates|policy/i);
      h.check("the coach sees the links of both their organizations", (await db.query(`select count(*)::int as n from public.pro_shop_links where title like 'PO %'`)).rows[0].n === 2);

      await h.as(cA);
      h.check("a client of A sees only A's link", (await db.query(`select title from public.pro_shop_links where title like 'PO %' order by title`)).rows.map((r) => r.title).join() === "PO in A");
      await h.as(cB1);
      h.check("a client of B sees only B's link", (await db.query(`select title from public.pro_shop_links where title like 'PO %' order by title`)).rows.map((r) => r.title).join() === "PO unfiled");

      // the same rule on a challenge (its program decides at backfill; a new one without an organization gets the coach's usual)
      await h.as(coach);
      const ch = await db.query(`insert into public.challenges (coach_id, name, start_date, duration_weeks) values ($1, 'PO challenge', current_date, 4) returning organization_id`, [coach]);
      h.check("a challenge saved without an organization also goes to the usual one", ch.rows[0].organization_id === orgB);
    },
  },
};
