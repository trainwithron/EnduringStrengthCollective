// 0421: one invitation link per invited person. Only the server reaches the table; at most one OPEN link per person and organization; a used or cancelled link does not block a new one; no link or secret is stored.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0421 One invitation link per person",
  migrations: ["0421"],
  phases: {
    async "0421"({ db, h }) {
      const owner = await h.user("JL Owner");
      const invitee = await h.user("JL Invitee");
      const other = await h.user("JL Other");
      const org = await h.org(owner, "JL Gym");
      const org2 = await h.org(other, "JL Other Gym");
      await h.asSuper();

      const cols = (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'coach_join_links' order by column_name`)).rows.map((r) => r.column_name);
      h.check("the table has the columns the code uses", ["created_at", "created_by", "expires_at", "id", "kind", "organization_id", "profile_id", "revoked_at", "used_at"].every((c) => cols.includes(c)), cols.join(","));
      h.check("and holds no token, no hash and no secret of any kind", !cols.some((c) => /token|hash|secret|link|code/.test(c)), cols.join(","));

      let r = await tryQ(db, `insert into public.coach_join_links (organization_id, profile_id, created_by, expires_at) values ($1, $2, $3, now() + interval '14 days') returning id, kind`, [org, invitee, owner]);
      h.check("a link can be made, and is an invitation by default" + (r.error ? ": " + r.error : ""), !r.error && r.rows[0].kind === "invite");
      const first = r.rows?.[0]?.id;

      r = await tryQ(db, `insert into public.coach_join_links (organization_id, profile_id, created_by, expires_at) values ($1, $2, $3, now() + interval '14 days')`, [org, invitee, owner]);
      h.check("a second OPEN link for the same person and organization is refused", !!r.error && /duplicate|unique/i.test(r.error), JSON.stringify(r));
      r = await tryQ(db, `insert into public.coach_join_links (organization_id, profile_id, created_by, expires_at) values ($1, $2, $3, now() + interval '14 days') returning id`, [org2, invitee, other]);
      h.check("another organization can have its own link for the same account" + (r.error ? ": " + r.error : ""), !r.error);

      await db.query(`update public.coach_join_links set used_at = now() where id = $1`, [first]);
      r = await tryQ(db, `insert into public.coach_join_links (organization_id, profile_id, created_by, expires_at, kind) values ($1, $2, $3, now() + interval '14 days', 'signin') returning id`, [org, invitee, owner]);
      h.check("once the first is used, a new one can be made (a sign-in link)" + (r.error ? ": " + r.error : ""), !r.error);
      const second = r.rows?.[0]?.id;
      await db.query(`update public.coach_join_links set revoked_at = now() where id = $1`, [second]);
      r = await tryQ(db, `insert into public.coach_join_links (organization_id, profile_id, created_by, expires_at) values ($1, $2, $3, now() + interval '14 days')`, [org, invitee, owner]);
      h.check("and so can one after a cancelled one" + (r.error ? ": " + r.error : ""), !r.error);

      r = await tryQ(db, `insert into public.coach_join_links (organization_id, profile_id, expires_at, kind) values ($1, $2, now() + interval '1 day', 'anything')`, [org, owner]);
      h.check("only the two kinds are allowed", !!r.error);

      // nobody signed in can see or touch the table
      for (const [who, label] of [[invitee, "the invited person"], [owner, "the owner of the organization"], [other, "someone else"]]) {
        await h.as(who);
        const read = await tryQ(db, `select count(*)::int as n from public.coach_join_links`);
        const write = await tryQ(db, `insert into public.coach_join_links (organization_id, profile_id, expires_at) values ($1, $2, now() + interval '1 day')`, [org2, owner]);
        const change = await tryQ(db, `update public.coach_join_links set expires_at = now() + interval '900 days'`);
        await h.asSuper();
        h.check(label + " cannot read, make or change a link", (!!read.error || read.rows[0].n === 0) && !!write.error && (!!change.error || change.rows.length === 0), JSON.stringify({ read, write, change }));
      }
      await h.as(null);
      r = await tryQ(db, `select count(*)::int as n from public.coach_join_links`);
      await h.asSuper();
      h.check("nor a signed-out visitor", !!r.error || r.rows[0].n === 0);

      // the links go with the account
      await db.query(`delete from public.profiles where id = $1`, [invitee]);
      r = await tryQ(db, `select count(*)::int as n from public.coach_join_links where profile_id = $1`, [invitee]);
      h.check("deleting the account (cancelling an invitation) removes its links", r.rows?.[0]?.n === 0, JSON.stringify(r));
    },
  },
};
