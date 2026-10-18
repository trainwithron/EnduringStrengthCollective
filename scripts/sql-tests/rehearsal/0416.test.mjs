// 0416: the restrictive write guard on posts. Nothing that was allowed before is refused for a person the function says true to; a blocked client cannot insert or edit a post by writing to the table directly.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0416 Write guard on posts",
  migrations: ["0416"],
  phases: {
    async "0416"({ db, h }) {
      const owner = await h.user("PG Owner");
      const coach = await h.user("PG Coach");
      const org = await h.org(owner, "PG Gym");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "PG Team");
      const client = async (name, dobSql, consent) => {
        const u = await h.user(name);
        await h.member(g, u);
        await h.asSuper();
        await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, ${dobSql})`, [u, g]);
        if (consent) await db.query(`insert into public.guardian_consents (athlete_id, guardian_email, token_hash, status) values ($1, 'p@example.com', $2, 'signed')`, [u, "h-" + u]);
        return u;
      };
      const adult = await client("PG Adult", `current_date - interval '30 years'`);
      const teenSigned = await client("PG Teen Signed", `current_date - interval '15 years'`, true);
      const teenUnsigned = await client("PG Teen Unsigned", `current_date - interval '15 years'`);
      const child = await client("PG Child", `current_date - interval '10 years'`);
      const noDate = await client("PG No Date", "null");

      const post = async (who, body) => {
        await h.as(who);
        const r = await tryQ(db, `insert into public.posts (group_id, author_id, body) values ($1, $2, $3) returning id`, [g, who, body]);
        await h.asSuper();
        return r;
      };

      // ---- the people who are allowed keep posting
      for (const [who, label] of [[coach, "a coach"], [adult, "an adult client"], [teenSigned, "a teen with a signed guardian"]]) {
        const r = await post(who, "hello from " + label);
        h.check(label + " can still post" + (r.error ? ": " + r.error : ""), !r.error && r.rows.length === 1);
      }

      // ---- the blocked ones cannot, by writing to the table directly
      for (const [who, label] of [[teenUnsigned, "a teen without a signed guardian"], [child, "a child under 13"], [noDate, "a client with no birthday on file"]]) {
        const r = await post(who, "should not exist");
        h.check(label + " cannot post by writing to the table" + (r.error ? "" : " (it went through)"), !!r.error && /row-level security/i.test(r.error), JSON.stringify(r));
      }
      await h.asSuper();
      h.check("and no row was created for them", (await db.query(`select count(*)::int as n from public.posts where body = 'should not exist'`)).rows[0].n === 0);

      // ---- editing: a blocked client cannot change a post (even one that was theirs before the guard)
      await db.query(`insert into public.posts (group_id, author_id, body) values ($1, $2, 'old post by the child')`, [g, child]);
      await h.as(child);
      const upd = await tryQ(db, `update public.posts set body = 'edited' where author_id = $1 returning id`, [child]);
      h.check("a blocked client cannot edit their own earlier post", !!upd.error || upd.rows.length === 0, JSON.stringify(upd));
      // ---- deleting is left alone: they can always take their own words down
      const del = await tryQ(db, `delete from public.posts where author_id = $1 returning id`, [child]);
      h.check("but they can still delete it" + (del.error ? ": " + del.error : ""), !del.error && del.rows.length === 1);

      // ---- an allowed client can edit nothing of someone else's (the earlier rules still apply on top)
      await h.as(adult);
      const other = await tryQ(db, `update public.posts set body = 'hijack' where author_id = $1 returning id`, [teenSigned]);
      h.check("the earlier rules still stand: an adult client cannot edit another client's post", !!other.error || other.rows.length === 0);
      await h.asSuper();

      // ---- the guard is restrictive and covers insert and update, to signed-in people only
      const pol = (await db.query(`select policyname, cmd, permissive, roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname like 'minor_write_guard_%' order by policyname`)).rows;
      h.check("two policies, one for insert and one for update, both restrictive, for signed-in people", pol.length === 2 && pol.every((p) => p.permissive === "RESTRICTIVE") && pol[0].cmd === "INSERT" && pol[1].cmd === "UPDATE" && pol.every((p) => /authenticated/.test(p.roles)), JSON.stringify(pol));
      h.check("none for delete", !pol.some((p) => p.cmd === "DELETE" || p.cmd === "ALL"));

      // ---- the server key is not affected
      await h.asService();
      const svc = await tryQ(db, `insert into public.posts (group_id, author_id, body) values ($1, $2, 'system post') returning id`, [g, child]);
      h.check("the server key still writes (server routes are guarded separately)" + (svc.error ? ": " + svc.error : ""), !svc.error);
      await h.asSuper();
    },
  },
};
