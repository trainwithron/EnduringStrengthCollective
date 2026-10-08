// 0314: client_ui_settings, the person's own display switches (hide exercise demos). Readable and writable only by the client themself; nobody else, not their coach, not a
// signed-out visitor; one row per client; removed with the account.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows, count: undefined };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0314 client_ui_settings (hide demos follows the person)",
  migrations: ["0314"],
  phases: {
    async "0314"({ db, h }) {
      const coach = await h.user("UI Coach");
      const ann = await h.user("UI Ann");
      const bo = await h.user("UI Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "UI group");
      await h.member(group, ann);
      await h.member(group, bo);

      await h.asSuper();
      const col = await h.one("select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'client_ui_settings' and column_name = 'hide_demos'");
      h.check("the switch exists and is off by default", col && /false/.test(col.column_default) && col.is_nullable === "NO", JSON.stringify(col));
      h.check("a client who never used it has no row (demos stay on)", (await h.rows("select 1 from public.client_ui_settings where athlete_id = $1", [ann])).length === 0);

      // the client saves their own switch (insert, then update)
      await h.as(ann);
      const ins = await tryQ(db, "insert into public.client_ui_settings (athlete_id, hide_demos) values ($1, true) on conflict (athlete_id) do update set hide_demos = excluded.hide_demos, updated_at = now()", [ann]);
      const off = await tryQ(db, "insert into public.client_ui_settings (athlete_id, hide_demos) values ($1, false) on conflict (athlete_id) do update set hide_demos = excluded.hide_demos, updated_at = now()", [ann]);
      const on = await tryQ(db, "insert into public.client_ui_settings (athlete_id, hide_demos) values ($1, true) on conflict (athlete_id) do update set hide_demos = excluded.hide_demos, updated_at = now()", [ann]);
      const mine = await h.rows("select hide_demos from public.client_ui_settings where athlete_id = $1", [ann]);
      h.check("a client can save and change their own switch", !ins.error && !off.error && !on.error && mine.length === 1 && mine[0].hide_demos === true, JSON.stringify({ ins, off, on, mine }));

      // nobody else sees it or changes it
      await h.as(bo);
      const seeBo = await h.rows("select * from public.client_ui_settings");
      const writeFor = await tryQ(db, "insert into public.client_ui_settings (athlete_id, hide_demos) values ($1, true)", [ann]);
      const changeAnn = await db.query("update public.client_ui_settings set hide_demos = false where athlete_id = $1", [ann]);
      const deleteAnn = await db.query("delete from public.client_ui_settings where athlete_id = $1", [ann]);
      h.check("another client sees nothing and cannot add, change or delete someone else's switch", seeBo.length === 0 && !!writeFor.error && (changeAnn.rowCount ?? 0) === 0 && (deleteAnn.rowCount ?? 0) === 0, JSON.stringify({ seeBo, writeFor }));
      await h.as(coach);
      const coachSees = await h.rows("select * from public.client_ui_settings");
      const coachChange = await db.query("update public.client_ui_settings set hide_demos = false where athlete_id = $1", [ann]);
      h.check("their coach cannot see or change it either", coachSees.length === 0 && (coachChange.rowCount ?? 0) === 0, JSON.stringify(coachSees));
      await h.asSuper();
      h.check("the switch is still what Ann set", (await h.one("select hide_demos from public.client_ui_settings where athlete_id = $1", [ann])).hide_demos === true);

      // signed-out and grants
      const grants = await h.one(
        "select has_table_privilege('anon', 'public.client_ui_settings', 'select') as asel, has_table_privilege('anon', 'public.client_ui_settings', 'insert') as ains, has_table_privilege('authenticated', 'public.client_ui_settings', 'truncate') as atr, has_table_privilege('authenticated', 'public.client_ui_settings', 'select') as sel"
      );
      h.check("signed-out visitors have no access and signed-in users cannot truncate it", !grants.asel && !grants.ains && !grants.atr && grants.sel, JSON.stringify(grants));

      // removed with the account
      await db.query("delete from public.profiles where id = $1", [ann]).catch(() => null);
      h.check("the row goes with the account", (await h.rows("select 1 from public.client_ui_settings where athlete_id = $1", [ann])).length === 0);
    },
  },
};
