// 0413: a wearable connection's token can be kept scrambled, so each token also gets a one-way fingerprint column the Garmin lookup uses. Only the server reaches the table.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0413 Wearable token fingerprint",
  migrations: ["0413"],
  phases: {
    async "0413"({ db, h }) {
      const client = await h.user("WT Client");
      const other = await h.user("WT Other");
      await h.asSuper();
      const col = (await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wearable_oauth_tokens' and column_name = 'access_token_hash'`)).rows;
      h.check("the fingerprint column is there", col.length === 1);
      const conn = (await db.query(`insert into public.wearable_connections (profile_id, provider, external_user_id) values ($1, 'garmin', null) returning id`, [client])).rows[0]?.id;
      h.check("a connection can be recorded", !!conn);
      let r = await tryQ(db, `insert into public.wearable_oauth_tokens (connection_id, access_token, refresh_token, expires_at, access_token_hash) values ($1, 'enc:v1:abc', 'enc:v1:def', now() + interval '1 hour', 'a1b2') returning id`, [conn]);
      h.check("a scrambled token and its fingerprint are stored" + (r.error ? ": " + r.error : ""), !r.error);
      r = await tryQ(db, `select connection_id from public.wearable_oauth_tokens where access_token_hash = 'a1b2'`);
      h.check("the connection is found by the fingerprint", r.rows?.[0]?.connection_id === conn);
      r = await tryQ(db, `update public.wearable_oauth_tokens set access_token = 'plain-token', refresh_token = 'plain-refresh', access_token_hash = null where connection_id = $1`, [conn]);
      h.check("a token saved before the fingerprint existed stays valid with no fingerprint", !r.error);

      await h.as(client);
      r = await tryQ(db, `select count(*)::int as n from public.wearable_oauth_tokens`);
      h.check("a signed-in person cannot read any token row, not even their own", !!r.error || r.rows[0].n === 0, JSON.stringify(r));
      r = await tryQ(db, `update public.wearable_oauth_tokens set access_token_hash = 'x'`);
      h.check("nor change the fingerprint", !!r.error || r.rows.length === 0);
      await h.as(other);
      r = await tryQ(db, `select count(*)::int as n from public.wearable_oauth_tokens where access_token_hash is not null`);
      h.check("nor anyone else", !!r.error || r.rows[0].n === 0);
    },
  },
};
