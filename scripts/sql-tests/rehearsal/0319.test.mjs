// 0319: audit_log_refuse_changes and audit_diff get a fixed search_path (pg_catalog) with their permissions and behaviour unchanged, and rls_auto_enable (the database's own event helper) is closed
// to the public, signed-out visitors and signed-in users while the server and the owner keep it. rls_auto_enable does not come from this repo's migrations (the platform makes it), so the
// "before" phase stands in a copy with the live permissions.
const aclOf = (h, sig) =>
  h.one(
    `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth, has_function_privilege('service_role', $1, 'execute') as svc, (select proacl::text from pg_proc where oid = $1::regprocedure) as acl`,
    [sig]
  );

export default {
  name: "0319 function search paths and rls_auto_enable",
  migrations: ["0319"],
  phases: {
    async "0318"({ db, h, state }) {
      await h.asSuper();
      // A stand-in for the platform's helper, with the permissions it has live (public, anon, signed-in, server).
      await db.query(`create or replace function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path to 'pg_catalog' as $$ begin null; end $$`);
      await db.query(`grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role`);
      state.before = {
        refuse: await aclOf(h, "public.audit_log_refuse_changes()"),
        diff: await aclOf(h, "public.audit_diff(jsonb, jsonb, text[])"),
        rls: await aclOf(h, "public.rls_auto_enable()"),
        refuseCfg: (await h.one(`select proconfig::text as c from pg_proc where oid = 'public.audit_log_refuse_changes()'::regprocedure`)).c,
        diffCfg: (await h.one(`select proconfig::text as c from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure`)).c,
      };
      h.check("before: neither audit function has a fixed search_path", state.before.refuseCfg === null && state.before.diffCfg === null, JSON.stringify(state.before));
      h.check("before: the helper can be run by the public and signed-in users", state.before.rls.anon && state.before.rls.auth, JSON.stringify(state.before.rls));
    },
    async "0319"({ db, h, state }) {
      await h.asSuper();
      const b = state.before;
      const refuseCfg = (await h.one(`select proconfig::text as c from pg_proc where oid = 'public.audit_log_refuse_changes()'::regprocedure`)).c;
      const diffCfg = (await h.one(`select proconfig::text as c from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure`)).c;
      h.check("audit_log_refuse_changes is pinned to pg_catalog", /search_path=pg_catalog/.test(refuseCfg ?? ""), String(refuseCfg));
      h.check("audit_diff is pinned to pg_catalog", /search_path=pg_catalog/.test(diffCfg ?? ""), String(diffCfg));

      // Who can run the two audit functions is exactly as before.
      const refuse = await aclOf(h, "public.audit_log_refuse_changes()");
      const diff = await aclOf(h, "public.audit_diff(jsonb, jsonb, text[])");
      h.check("audit_log_refuse_changes keeps exactly the permissions it had", refuse.acl === b.refuse.acl, JSON.stringify({ before: b.refuse.acl, after: refuse.acl }));
      h.check("audit_diff keeps exactly the permissions it had", diff.acl === b.diff.acl, JSON.stringify({ before: b.diff.acl, after: diff.acl }));

      // They still do their jobs.
      const d = await h.one(`select public.audit_diff('{"a":1,"b":2}'::jsonb, '{"a":1,"b":3}'::jsonb, array['a','b']) as d`);
      h.check("audit_diff still reports only what changed", Object.keys(d.d).length === 1 && d.d.b?.old === 2 && d.d.b?.new === 3, JSON.stringify(d.d));
      const fresh = await h.one(`select public.audit_diff(null, '{"a":1}'::jsonb, array['a']) as d`);
      h.check("audit_diff still reports a new row's values", Object.keys(fresh.d).length === 1 && fresh.d.a?.new === 1 && fresh.d.a?.old === undefined, JSON.stringify(fresh.d));
      let refused = null;
      try {
        await db.query(`select public.audit_log_refuse_changes()`);
      } catch (e) {
        refused = String(e.message).split("\n")[0];
      }
      h.check("the audit log still refuses changes (the trigger function raises)", refused !== null && /append-only|trigger/i.test(refused), String(refused));

      // The helper is closed to the public, signed-out visitors and signed-in users; the server and the owner keep it.
      const rls = await aclOf(h, "public.rls_auto_enable()");
      h.check("rls_auto_enable is closed to signed-out visitors and signed-in users", !rls.anon && !rls.auth, JSON.stringify(rls));
      h.check("and to the public pseudo-role (no '=X/' entry)", !/(^|[{,])=X\//.test(rls.acl ?? ""), String(rls.acl));
      h.check("the server (service role) keeps it", rls.svc === true, JSON.stringify(rls));
      const owner = await h.one(`select has_function_privilege(current_user, 'public.rls_auto_enable()', 'execute') as ok`);
      h.check("and the owner keeps it", owner.ok === true, JSON.stringify(owner));

      // Re-running changes nothing and raises nothing.
      let again = null;
      try {
        await db.query((await import("node:fs")).readFileSync(new URL("../../../supabase/migrations/0319_function_search_paths.sql", import.meta.url), "utf8"));
      } catch (e) {
        again = String(e.message).split("\n")[0];
      }
      h.check("running the file a second time is harmless", again === null, String(again));
    },
  },
};
