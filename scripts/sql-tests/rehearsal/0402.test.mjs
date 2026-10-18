// 0402: guardian consent. The table is the server's only; the state function answers for the child and their coach, and nobody else.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0402 Guardian consent",
  migrations: ["0402"],
  phases: {
    async "0402"({ db, h }) {
      const coach = await h.user("GC Coach");
      const otherCoach = await h.user("GC Other Coach");
      const teen = await h.user("GC Teen");
      const peer = await h.user("GC Peer");
      const org = await h.org(coach, "GC Gym");
      await h.orgMember(org, otherCoach, "coach");
      const g = await h.group(org, coach, "team", "GC Team");
      await h.member(g, teen);
      await h.member(g, peer);
      const state = async (who, athlete) => {
        await h.as(who);
        const r = await tryQ(db, `select public.guardian_consent_state($1) as s`, [athlete]);
        await h.asSuper();
        return r.error ? { error: r.error } : r.rows[0].s;
      };

      // ---- the table is the server's only
      for (const [who, label] of [[coach, "a coach"], [teen, "the child"]]) {
        await h.as(who);
        let r = await tryQ(db, `select count(*)::int as n from public.guardian_consents`);
        h.check(label + " cannot read the consent table", !!r.error || r.rows[0].n === 0, JSON.stringify(r));
        r = await tryQ(db, `insert into public.guardian_consents (athlete_id, guardian_email, token_hash) values ($1, 'x@example.com', 'h1')`, [teen]);
        h.check(label + " cannot write it", !!r.error);
        await h.asSuper();
      }

      // ---- nothing yet
      h.check("with no request the state is 'none'", (await state(teen, teen)).state === "none");

      // ---- a waiting request
      await db.query(`insert into public.guardian_consents (athlete_id, guardian_email, token_hash) values ($1, 'parent@example.com', 'hash-pending')`, [teen]);
      let s = await state(teen, teen);
      h.check("the child sees that a request is waiting, and for which address", s.state === "pending" && s.guardian_email === "parent@example.com", JSON.stringify(s));
      h.check("the answer never carries the link hash or the words", !("token_hash" in s) && !("doc_text" in s));
      s = await state(coach, teen);
      h.check("their coach sees the same", s.state === "pending");
      h.check("a coach of another group is told nothing", (await state(otherCoach, teen)) === null);
      h.check("nor another client", (await state(peer, teen)) === null);

      // ---- an expired request is not waiting
      await db.query(`update public.guardian_consents set expires_at = now() - interval '1 day' where token_hash = 'hash-pending'`);
      h.check("an expired request shows as 'expired' (with its address, so the coach can resend)", (await state(coach, teen)).state === "expired" && (await state(coach, teen)).guardian_email === "parent@example.com");

      // ---- signed
      await db.query(`update public.guardian_consents set status = 'signed', guardian_name = 'Pat Parent', relationship = 'Parent', residence_state = 'AL', majority_age = 19, doc_version = 'v1', doc_sha256 = 'abc', doc_text = 'words', signed_at = now(), signed_ip = '203.0.113.9', signed_user_agent = 'UA' where token_hash = 'hash-pending'`);
      s = await state(coach, teen);
      h.check("a signature that stands is 'signed', with who signed", s.state === "signed" && s.guardian_name === "Pat Parent" && s.relationship === "Parent", JSON.stringify(s));
      h.check("the address and device it was signed from are not in the answer", !("signed_ip" in s) && !("signed_user_agent" in s));
      const dup = await tryQ(db, `insert into public.guardian_consents (athlete_id, guardian_email, token_hash, status) values ($1, 'other@example.com', 'h2', 'signed')`, [teen]);
      h.check("a child has at most one standing signature", !!dup.error);
      await db.query(`insert into public.guardian_consents (athlete_id, guardian_email, token_hash) values ($1, 'new@example.com', 'hash-new')`, [teen]);
      h.check("a standing signature still wins over a newer waiting request", (await state(teen, teen)).state === "signed");

      // ---- withdrawn
      await db.query(`update public.guardian_consents set status = 'withdrawn', withdrawn_at = now() where token_hash = 'hash-pending'`);
      s = await state(teen, teen);
      h.check("after a withdrawal a newer waiting request is what the child sees", s.state === "pending" && s.guardian_email === "new@example.com", JSON.stringify(s));
      await db.query(`update public.guardian_consents set status = 'replaced' where token_hash = 'hash-new'`);
      h.check("with nothing waiting a withdrawal shows as 'withdrawn'", (await state(teen, teen)).state === "withdrawn");

      // ---- a client cannot rewrite their own date of birth once it is on file
      await db.query(`insert into public.client_intake (athlete_id, group_id) values ($1, $2) on conflict do nothing`, [teen, g]);
      await h.as(teen);
      let u = await tryQ(db, `update public.client_intake set date_of_birth = '2012-05-01' where athlete_id = $1 returning 1`, [teen]);
      h.check("the first date of birth is the client's to give", !u.error && u.rows.length === 1, JSON.stringify(u));
      u = await tryQ(db, `update public.client_intake set date_of_birth = '1990-01-01' where athlete_id = $1`, [teen]);
      h.check("but once on file they cannot change it to an adult's", !!u.error && /can't be changed here\. Ask your coach to contact support/.test(u.error), JSON.stringify(u));
      u = await tryQ(db, `update public.client_intake set date_of_birth = '2012-05-01' where athlete_id = $1 returning 1`, [teen]);
      h.check("writing the same date again is harmless", !u.error, JSON.stringify(u));
      await h.as(coach);
      u = await tryQ(db, `update public.client_intake set date_of_birth = '1990-01-01' where athlete_id = $1 returning 1`, [teen]);
      h.check("a coach has no write on the table either", !u.error && u.rows.length === 0, JSON.stringify(u));
      await h.asSuper();
      u = await tryQ(db, `update public.client_intake set date_of_birth = '2011-05-01' where athlete_id = $1`, [teen]);
      h.check("a correction made by the server (support) goes through", !u.error, JSON.stringify(u));

      // ---- the server's own view
      await h.asService();
      const r = await tryQ(db, `select public.guardian_consent_state($1) as s`, [teen]);
      h.check("the server can ask for any child", !r.error && r.rows[0].s.state === "withdrawn", JSON.stringify(r));
      await h.asSuper();
    },
  },
};
