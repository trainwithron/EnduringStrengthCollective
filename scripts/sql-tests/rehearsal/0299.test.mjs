// 0299: the record of what people agreed to can only be added to. No role, not even the server key, can change or delete a row or truncate the table; a person's own
// acceptances are still readable by them; and deleting a person's account still removes their rows (the foreign key's cascade is let through).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0299 legal acceptances are append-only",
  migrations: ["0299"],
  phases: {
    async "0298"({ db, h }) {
      const t = await h.one(`select count(*)::int as n from pg_trigger where tgrelid = 'public.legal_acceptances'::regclass and not tgisinternal`);
      h.check("baseline: no triggers on the acceptance record yet", t.n === 0, JSON.stringify(t));
      const ann = await h.user("LA Ann");
      const bob = await h.user("LA Bob");
      await h.asSuper();
      await db.query(
        `insert into public.legal_acceptances (profile_id, document, version, text_snapshot) values ($1, 'beta_notice', '2026-10-05-draft-3', 'old text'), ($2, 'beta_notice', '2026-10-05-draft-3', 'old text')`,
        [ann, bob]
      );
      const before = await h.one(`select has_table_privilege('authenticated', 'public.legal_acceptances', 'UPDATE') as u, has_table_privilege('authenticated', 'public.legal_acceptances', 'DELETE') as d`);
      h.check("baseline: the app's role could still update and delete (what 0299 closes)", before.u === true && before.d === true, JSON.stringify(before));
      globalThis.__la = { ann, bob };
    },

    async "0299"({ db, h }) {
      const { ann, bob } = globalThis.__la;

      // ---- adding is unchanged ----
      await h.asService();
      const add = await tryQ(db, `insert into public.legal_acceptances (profile_id, document, version, text_snapshot) values ($1, 'beta_notice', '2026-10-08-draft-4', 'new text') returning id`, [ann]);
      h.check("the server can still add an acceptance", !add.error && add.rows?.length === 1, JSON.stringify(add));
      const dup = await tryQ(db, `insert into public.legal_acceptances (profile_id, document, version) values ($1, 'beta_notice', '2026-10-08-draft-4') on conflict (profile_id, document, version) do nothing`, [ann]);
      h.check("adding the same version again ('on conflict do nothing', how the app writes) still works and changes nothing", !dup.error, JSON.stringify(dup));

      // ---- nobody can change or delete a row ----
      for (const [who, run] of [["the server key", () => h.asService()], ["the platform admin", () => h.asSuper()]]) {
        await run();
        const upd = await tryQ(db, `update public.legal_acceptances set version = 'x' where profile_id = $1`, [ann]);
        h.check(`${who} cannot update an acceptance`, !!upd.error && /append-only/.test(upd.error), JSON.stringify(upd));
        const del = await tryQ(db, `delete from public.legal_acceptances where profile_id = $1`, [ann]);
        h.check(`${who} cannot delete an acceptance`, !!del.error && /append-only/.test(del.error), JSON.stringify(del));
        const trunc = await tryQ(db, `truncate public.legal_acceptances`);
        h.check(`${who} cannot truncate the record`, !!trunc.error && /append-only/.test(trunc.error), JSON.stringify(trunc));
      }
      await h.as(ann);
      const mineUpd = await tryQ(db, `update public.legal_acceptances set version = 'x' where profile_id = $1`, [ann]);
      h.check("a signed-in person cannot update their own acceptance (no privilege)", !!mineUpd.error, JSON.stringify(mineUpd));
      const mineDel = await tryQ(db, `delete from public.legal_acceptances where profile_id = $1`, [ann]);
      h.check("a signed-in person cannot delete their own acceptance (no privilege)", !!mineDel.error, JSON.stringify(mineDel));
      const priv = await h.one(`select has_table_privilege('authenticated', 'public.legal_acceptances', 'UPDATE') as u, has_table_privilege('authenticated', 'public.legal_acceptances', 'DELETE') as d, has_table_privilege('anon', 'public.legal_acceptances', 'TRUNCATE') as t, has_table_privilege('authenticated', 'public.legal_acceptances', 'SELECT') as s`);
      h.check("the app's roles lost update, delete and truncate and kept select", priv.u === false && priv.d === false && priv.t === false && priv.s === true, JSON.stringify(priv));

      // ---- reading is unchanged ----
      const mine = await h.rows(`select version from public.legal_acceptances order by version`);
      h.check("a person still reads their own acceptances, and only theirs", mine.length === 2 && mine.every((r) => /draft/.test(r.version)), JSON.stringify(mine));

      // ---- the record is intact after all those refused attempts ----
      await h.asSuper();
      const intact = await h.one(`select count(*)::int as n, count(*) filter (where text_snapshot is not null)::int as snaps from public.legal_acceptances where profile_id in ($1, $2)`, [ann, bob]);
      h.check("after every refused change all three rows are still there with their text", intact.n === 3 && intact.snaps === 3, JSON.stringify(intact));

      // ---- deleting a person's account still removes their rows (the cascade is let through) ----
      const gone = await tryQ(db, `delete from public.profiles where id = $1`, [bob]);
      h.check("deleting a person's account is not blocked by the record", !gone.error, JSON.stringify(gone));
      const left = await h.one(`select (select count(*)::int from public.legal_acceptances where profile_id = $1) as bob, (select count(*)::int from public.legal_acceptances where profile_id = $2) as ann`, [bob, ann]);
      h.check("their acceptances went with the account and nobody else's did", left.bob === 0 && left.ann === 2, JSON.stringify(left));
    },
  },
};
