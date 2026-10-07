// 0292 (Release F): the AI call log can record a short error class; nothing existing changes.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0292 AI usage error class",
  migrations: ["0292"],
  phases: {
    async "0292"({ db, h }) {
      await h.asSuper();
      const col = await h.one(`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_log' and column_name = 'error_class'`);
      h.check("ai_usage_log has a nullable error_class column", col?.is_nullable === "YES", JSON.stringify(col));
      const ok = await tryQ(db, `insert into public.ai_usage_log (feature, status, error_class) values ('test_feature', 'error', 'credit') returning error_class`, []);
      const none = await tryQ(db, `insert into public.ai_usage_log (feature, status) values ('test_feature', 'ok') returning error_class`, []);
      const long = await tryQ(db, `insert into public.ai_usage_log (feature, status, error_class) values ('test_feature', 'error', repeat('x', 41))`, []);
      h.check("a short class is stored", !ok.error && ok.rows?.[0]?.error_class === "credit", JSON.stringify(ok));
      h.check("an existing-style insert (no class) still works", !none.error && none.rows?.[0]?.error_class === null, JSON.stringify(none));
      h.check("a class longer than 40 characters is refused", /ai_usage_log_error_class_len|violates check/.test(long.error ?? ""), JSON.stringify(long));
      await db.query(`delete from public.ai_usage_log where feature = 'test_feature'`);
    },
  },
};
