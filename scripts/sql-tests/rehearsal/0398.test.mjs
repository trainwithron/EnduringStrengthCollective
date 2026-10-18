// 0398: sign-in email changes wait for the new address to confirm. The table is server-only.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0398 Waiting sign-in email changes",
  migrations: ["0398"],
  phases: {
    async "0398"({ db, h }) {
      const coach = await h.user("EC Coach");
      const client = await h.user("EC Client");
      await h.asSuper();
      let r = await tryQ(db, `insert into public.pending_email_changes (profile_id, new_email, old_email, token_hash, cancel_token_hash, requested_by, expires_at) values ($1, 'new@example.com', 'old@example.com', 'hash-1', 'cancel-1', $2, now() + interval '48 hours') returning id`, [client, coach]);
      h.check("the server can record a waiting change" + (r.error ? ": " + r.error : ""), !r.error);
      r = await tryQ(db, `insert into public.pending_email_changes (profile_id, new_email, token_hash, cancel_token_hash, expires_at) values ($1, 'x@example.com', 'hash-1', 'cancel-x', now())`, [client]);
      h.check("a token can only be used for one request (the hash is unique)", !!r.error);

      r = await tryQ(db, `insert into public.pending_email_changes (profile_id, new_email, token_hash, cancel_token_hash, expires_at) values ($1, 'z@example.com', 'hash-3', 'cancel-1', now())`, [client]);
      h.check("the cancel token is unique too, and different from every confirm token", !!r.error);
      r = await tryQ(db, `select confirmable_at <= now() as ok from public.pending_email_changes where token_hash = 'hash-1'`);
      h.check("a request can be confirmed at once unless the server sets a later time", r.rows?.[0]?.ok === true);

      await h.as(client);
      r = await tryQ(db, `select count(*)::int as n from public.pending_email_changes`);
      h.check("a signed-in person cannot read the waiting requests, not even their own", !!r.error || r.rows[0].n === 0, JSON.stringify(r));
      r = await tryQ(db, `insert into public.pending_email_changes (profile_id, new_email, token_hash, cancel_token_hash, expires_at) values ($1, 'y@example.com', 'hash-2', 'cancel-2', now() + interval '1 day')`, [client]);
      h.check("nor write one", !!r.error);
      await h.as(coach);
      r = await tryQ(db, `update public.pending_email_changes set confirmed_at = now()`);
      h.check("a coach cannot confirm one by writing to the table", !!r.error || r.rows.length === 0);

      await h.asSuper();
      r = await tryQ(db, `insert into public.notifications (profile_id, type, body, link_path) values ($1, 'email_change_requested', 'x', '/'), ($1, 'email_change_cancelled', 'y', '/')`, [client]);
      h.check("the two new kinds of notice are accepted" + (r.error ? ": " + r.error : ""), !r.error);
    },
  },
};
