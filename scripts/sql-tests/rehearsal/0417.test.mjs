// 0417: the same restrictive write guard on the rest of the covered tables, plus the live-catalog guard: a table that shows a child to other people cannot be added later without being either guarded or listed
// below as deliberately left out.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

const GUARDED = ["posts", "comments", "reactions", "direct_messages", "exercise_video_comments", "training_partner_profiles", "training_partner_requests", "challenge_participants", "progress_photos", "session_exercise_videos", "body_weight_logs", "body_scans", "transformation_cards", "transformation_milestones"];

// Security-definer functions that write a guarded table and are fine without the question, and why.
const WRITERS_THAT_ARE_FINE = {
  move_client_to_group: "coach-only: moves a client's weigh-ins to another group with them; writes nothing new",
  send_away_reply: "a trigger: the COACH's automatic away reply, written as the coach, in answer to a client's message",
};

// Tables with a column that names who wrote the row (author_id, sender_id, commenter_id ...) that are deliberately NOT guarded, and why. Anything else with such a column must be guarded.
const LEFT_OUT = {
  support_messages: "a child must always be able to ask for help",
};

export default {
  name: "0417 Write guard on the rest",
  migrations: ["0417"],
  phases: {
    async "0417"({ db, h }) {
      const owner = await h.user("RG Owner");
      const coach = await h.user("RG Coach");
      const org = await h.org(owner, "RG Gym");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "RG Team");
      const client = async (name, dobSql, consent) => {
        const u = await h.user(name);
        await h.member(g, u);
        await h.asSuper();
        await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, ${dobSql})`, [u, g]);
        if (consent) await db.query(`insert into public.guardian_consents (athlete_id, guardian_email, token_hash, status) values ($1, 'p@example.com', $2, 'signed')`, [u, "h-" + u]);
        return u;
      };
      const adult = await client("RG Adult", `current_date - interval '30 years'`);
      const teenSigned = await client("RG Teen Signed", `current_date - interval '15 years'`, true);
      const child = await client("RG Child", `current_date - interval '10 years'`);

      // ---- every table is guarded, restrictively, for insert and update, and not for delete
      await h.asSuper();
      const pol = (await db.query(`select tablename, cmd, permissive from pg_policies where schemaname = 'public' and policyname like 'minor_write_guard_%'`)).rows;
      for (const t of GUARDED) {
        const mine = pol.filter((p) => p.tablename === t);
        h.check(`${t}: restrictive insert and update guards, nothing else`, mine.length === 2 && mine.every((p) => p.permissive === "RESTRICTIVE") && mine.some((p) => p.cmd === "INSERT") && mine.some((p) => p.cmd === "UPDATE"), JSON.stringify(mine));
      }
      h.check("no other table got a guard", pol.every((p) => GUARDED.includes(p.tablename)), JSON.stringify(pol.filter((p) => !GUARDED.includes(p.tablename))));

      // ---- a few tables exercised for real
      await db.query(`insert into public.posts (group_id, author_id, body) values ($1, $2, 'seed post')`, [g, coach]);
      const postId = (await db.query(`select id from public.posts where body = 'seed post'`)).rows[0].id;
      const comment = async (who) => {
        await h.as(who);
        const r = await tryQ(db, `insert into public.comments (post_id, group_id, author_id, body) values ($1, $2, $3, 'hi') returning id`, [postId, g, who]);
        await h.asSuper();
        return r;
      };
      let r = await comment(adult);
      h.check("an adult client can still comment" + (r.error ? ": " + r.error : ""), !r.error && r.rows.length === 1);
      r = await comment(teenSigned);
      h.check("a teen with a signed guardian can still comment" + (r.error ? ": " + r.error : ""), !r.error && r.rows.length === 1);
      r = await comment(coach);
      h.check("a coach can still comment" + (r.error ? ": " + r.error : ""), !r.error && r.rows.length === 1);
      r = await comment(child);
      h.check("a child under 13 cannot comment by writing to the table", !!r.error && /row-level security/i.test(r.error), JSON.stringify(r));

      const weight = async (who, w) => {
        await h.as(who);
        const x = await tryQ(db, `insert into public.body_weight_logs (athlete_id, group_id, weight) values ($1, $2, $3) returning id`, [who, g, w]);
        await h.asSuper();
        return x;
      };
      r = await weight(adult, 180);
      h.check("an adult client can still log a weight" + (r.error ? ": " + r.error : ""), !r.error);
      r = await weight(child, 80);
      h.check("a child under 13 cannot log a weight by writing to the table", !!r.error && /row-level security/i.test(r.error), JSON.stringify(r));

      const message = async (from, to) => {
        await h.as(from);
        const x = await tryQ(db, `insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'hey') returning id`, [g, from, to]);
        await h.asSuper();
        return x;
      };
      r = await message(coach, child);
      h.check("a coach can still message a child" + (r.error ? ": " + r.error : ""), !r.error);
      r = await message(child, coach);
      h.check("a child under 13 cannot message by writing to the table", !!r.error && /row-level security/i.test(r.error), JSON.stringify(r));

      // ---- an upsert (insert, or update on conflict) goes through for an allowed person and not for a blocked one
      await h.as(adult);
      r = await tryQ(db, `insert into public.body_weight_logs (athlete_id, group_id, weight) values ($1, $2, 181) on conflict (athlete_id, logged_date) do update set weight = excluded.weight returning weight`, [adult, g]);
      h.check("an adult's weight upsert (the app's own pattern) works, also the second time, as an update" + (r.error ? ": " + r.error : ""), !r.error && Number(r.rows[0]?.weight) === 181);
      await h.asSuper();
      await db.query(`insert into public.body_weight_logs (athlete_id, group_id, weight) values ($1, $2, 79)`, [child, g]);
      await h.as(child);
      r = await tryQ(db, `update public.body_weight_logs set weight = 70 where athlete_id = $1 returning id`, [child]);
      h.check("a blocked client cannot change an earlier weight either", !!r.error || r.rows.length === 0, JSON.stringify(r));
      await h.asSuper();
      // a recipient marking a message read: refused for a blocked recipient, silently
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'from coach')`, [g, coach, child]);
      await h.as(child);
      r = await tryQ(db, `update public.direct_messages set read_at = now() where recipient_id = $1 returning id`, [child]);
      h.check("a blocked recipient cannot mark messages read (nothing changes, no error is shown to them)", !r.error && r.rows.length === 0, JSON.stringify(r));
      await h.asSuper();

      // ---- the scan function, which bypasses the table policies, asks the question itself
      const scan = async (who, athlete) => {
        await h.as(who);
        const x = await tryQ(db, `select public.save_body_scan($1, $2, $3::jsonb, null, true) as r`, [g, athlete, JSON.stringify({ scanDate: new Date().toISOString().slice(0, 10), weightLb: 150 })]);
        await h.asSuper();
        return x;
      };
      r = await scan(adult, adult);
      h.check("an adult can save their own scan, and the weigh-in it carries" + (r.error ? ": " + r.error : ""), !r.error);
      r = await scan(child, child);
      h.check("a blocked client cannot save a scan by calling the function", !!r.error && /not authorized/.test(r.error), JSON.stringify(r));
      h.check("and no scan or weigh-in was written for them by it", (await db.query(`select count(*)::int as n from public.body_scans where athlete_id = $1`, [child])).rows[0].n === 0);
      r = await scan(coach, child);
      h.check("a coach can save a scan for that same client" + (r.error ? ": " + r.error : ""), !r.error);

      // ---- no other function that writes a guarded table around the policies is missing the question
      const writers = (
        await db.query(`
          select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosrc
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'`)
      ).rows.filter((x) => new RegExp("(insert\\s+into|update)\\s+(public\\.)?(" + GUARDED.join("|") + ")\\b", "i").test(x.prosrc));
      const unasked = writers.filter((x) => !/minor_may_write/.test(x.prosrc) && !(x.proname in WRITERS_THAT_ARE_FINE)).map((x) => x.proname);
      h.check("every security-definer function that writes a guarded table asks minor_may_write or is listed as fine" + (unasked.length ? ": " + unasked.join(", ") : ""), unasked.length === 0);

      // ---- the pictures and videos themselves
      const storageGuard = (await db.query(`select policyname, cmd, permissive from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'minor_write_guard_storage_%' order by cmd`)).rows;
      h.check("restrictive insert and update policies on file storage", storageGuard.length === 2 && storageGuard.every((p) => p.permissive === "RESTRICTIVE") && storageGuard[0].cmd === "INSERT" && storageGuard[1].cmd === "UPDATE", JSON.stringify(storageGuard));
      const upload = async (who, bucket, owner) => {
        await h.as(who);
        const x = await tryQ(db, `insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3) returning id`, [bucket, owner + "/test.jpg", who]);
        await h.asSuper();
        return x;
      };
      r = await upload(child, "progress-photos", child);
      h.check("a blocked client cannot upload a progress photo" + (r.error ? "" : " (it went through)"), !!r.error && /row-level security/i.test(r.error), JSON.stringify(r));
      r = await upload(child, "post-media", child);
      h.check("nor to the feed's media bucket", !!r.error && /row-level security/i.test(r.error), JSON.stringify(r));
      r = await upload(adult, "progress-photos", adult);
      h.check("an adult's upload to the same bucket still works" + (r.error ? ": " + r.error : ""), !r.error);

      // ---- the live-catalog guard
      const authorish = (
        await db.query(`
          select distinct c.table_name
          from information_schema.columns c
          join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
          where c.table_schema = 'public' and c.column_name in ('author_id', 'sender_id', 'commenter_id', 'poster_id', 'writer_id')
          order by 1`)
      ).rows.map((x) => x.table_name);
      const unlisted = authorish.filter((t) => !GUARDED.includes(t) && !(t in LEFT_OUT));
      h.check("every table with an author-style column is guarded or listed as deliberately left out" + (unlisted.length ? ": " + unlisted.join(", ") : ""), unlisted.length === 0);
      const stale = Object.keys(LEFT_OUT).filter((t) => !authorish.includes(t));
      h.check("the left-out list names no table that is gone" + (stale.length ? ": " + stale.join(", ") : ""), stale.length === 0);
    },
  },
};
