-- Performance advisor: auth_rls_initplan. Every RLS policy that calls
-- auth.uid() directly re-evaluates it once per row scanned; wrapping it
-- as (select auth.uid()) lets Postgres evaluate it once per statement via
-- an InitPlan instead. Same result either way (auth.uid() is stable
-- within one statement) — this only changes performance, not behavior.
--
-- Done programmatically (read each policy's live definition, regex-wrap
-- every auth.uid() occurrence, drop and recreate with that exact
-- transformed expression) rather than hand-transcribed, since manually
-- retyping ~79 security-critical policies risks a transcription error
-- that silently changes access control. This only touches policies that
-- actually reference auth.uid() and only wraps that one call pattern —
-- every other clause (is_group_coach(...), is_client_of_coach(...), etc.)
-- passes through completely unchanged.
do $body$
declare
  r record;
  new_using text;
  new_check text;
  cmd_text text;
begin
  for r in
    select
      c.relname as table_name,
      p.polname as policy_name,
      p.polcmd as cmd,
      pg_get_expr(p.polqual, p.polrelid) as using_expr,
      pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace
      and (
        pg_get_expr(p.polqual, p.polrelid) ~ 'auth\.uid\(\)'
        or pg_get_expr(p.polwithcheck, p.polrelid) ~ 'auth\.uid\(\)'
      )
  loop
    new_using := case when r.using_expr is not null
      then regexp_replace(r.using_expr, 'auth\.uid\(\)', '(select auth.uid())', 'g')
      else null end;
    new_check := case when r.check_expr is not null
      then regexp_replace(r.check_expr, 'auth\.uid\(\)', '(select auth.uid())', 'g')
      else null end;

    cmd_text := case r.cmd
      when 'r' then 'select'
      when 'a' then 'insert'
      when 'w' then 'update'
      when 'd' then 'delete'
      when '*' then 'all'
    end;

    execute format('drop policy %I on public.%I', r.policy_name, r.table_name);

    execute format(
      'create policy %I on public.%I for %s to authenticated %s %s',
      r.policy_name,
      r.table_name,
      cmd_text,
      case when new_using is not null then 'using (' || new_using || ')' else '' end,
      case when new_check is not null then 'with check (' || new_check || ')' else '' end
    );
  end loop;
end
$body$;
