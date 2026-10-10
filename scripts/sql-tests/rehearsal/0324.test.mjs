// 0324: AI builder drafts. A program the AI builds is a draft (ai_draft) and can never be active until signed off; signing off is one update; a copy of a draft is a draft; the copy of a
// signed-off program is active exactly as before; existing programs are untouched.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0324 AI drafts cannot go live until signed off",
  migrations: ["0324"],
  phases: {
    async "0324"({ db, h }) {
      const coach = await h.user("AD Coach");
      const ann = await h.user("AD Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "AD group");
      await h.member(group, ann);

      await h.asSuper();
      const existing = await h.rows("select count(*)::int as n from public.programs where ai_draft is true");
      h.check("no existing program is a draft", existing[0].n === 0);

      // A coach saves an AI draft: inactive is fine, active is refused.
      await h.as(coach);
      const draft = (await h.one("insert into public.programs (group_id, name, created_by, is_active, ai_draft) values ($1, 'AI draft', $2, false, true) returning id", [group, coach])).id;
      h.check("a draft can be saved inactive", !!draft);
      const bad = await tryQ(db, "insert into public.programs (group_id, name, created_by, is_active, ai_draft) values ($1, 'AI live', $2, true, true)", [group, coach]);
      h.check("a draft cannot be created active", !!bad.error && /signed off/.test(bad.error), JSON.stringify(bad));
      const toggled = await tryQ(db, "update public.programs set is_active = true where id = $1", [draft]);
      h.check("the Active toggle cannot make an unsigned draft live", !!toggled.error && /signed off/.test(toggled.error), JSON.stringify(toggled));
      await h.asSuper();
      const still = await h.one("select is_active, ai_draft from public.programs where id = $1", [draft]);
      h.check("...and the draft is unchanged", still.is_active === false && still.ai_draft === true);

      // A copy of a draft is a draft, and is never live.
      await h.as(coach);
      const copy = (await h.one("select public.duplicate_program($1, $2, $3, $4, 'Ann') as id", [draft, group, coach, ann])).id;
      await h.asSuper();
      const c = await h.one("select is_active, ai_draft from public.programs where id = $1", [copy]);
      h.check("assigning a draft to a client makes a draft copy that is NOT active", c.ai_draft === true && c.is_active === false, JSON.stringify(c));

      // Sign-off: one update.
      await h.as(coach);
      const signed = await tryQ(db, "update public.programs set ai_draft = false, is_active = true where id = $1 returning id", [draft]);
      h.check("signing off (one update) makes it active", !signed.error && signed.rows.length === 1, JSON.stringify(signed));
      await h.asSuper();
      const s2 = await h.one("select is_active, ai_draft from public.programs where id = $1", [draft]);
      h.check("it is active and no longer a draft", s2.is_active === true && s2.ai_draft === false);

      // A copy of a signed-off program is live, exactly as before.
      await h.as(coach);
      const copy2 = (await h.one("select public.duplicate_program($1, $2, $3, $4, 'Ann') as id", [draft, group, coach, ann])).id;
      await h.asSuper();
      const c2 = await h.one("select is_active, ai_draft from public.programs where id = $1", [copy2]);
      h.check("a copy of a signed-off program is active, as before", c2.is_active === true && c2.ai_draft === false, JSON.stringify(c2));

      // An ordinary program is unaffected.
      await h.as(coach);
      const plain = await tryQ(db, "insert into public.programs (group_id, name, created_by) values ($1, 'Plain', $2) returning is_active, ai_draft", [group, coach]);
      h.check("an ordinary new program is active and not a draft, as before", plain.rows?.[0]?.is_active === true && plain.rows[0].ai_draft === false, JSON.stringify(plain));

      // The guard function is not callable by users.
      await h.asSuper();
      const open = await h.one("select has_function_privilege('authenticated', 'public.guard_ai_draft_not_active()', 'execute') as a, has_function_privilege('anon', 'public.guard_ai_draft_not_active()', 'execute') as b");
      h.check("the guard function cannot be run by a signed-in user or a visitor", open.a === false && open.b === false);

      // A client can never see a draft (they are not active), and cannot change one.
      await h.as(ann);
      const seen = await h.rows("select id from public.programs where id = $1 and is_active", [draft]);
      void seen;
      const write = await tryQ(db, "update public.programs set ai_draft = false, is_active = true where id = $1 returning id", [copy]);
      h.check("a client cannot sign off a draft", !!write.error || (write.rows ?? []).length === 0, JSON.stringify(write));
    },
  },
};
