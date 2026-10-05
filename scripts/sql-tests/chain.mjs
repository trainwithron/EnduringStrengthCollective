// Applies every file in supabase/migrations to an empty in-memory Postgres (PGlite) in order, with stand-ins for Supabase pieces (auth, storage,
// realtime) and the owner account migration 0049 looks up. Reports which files fail. Expected today: 0030 (drops a policy that only exists
// live), 0248 (patches complete_workout_session by exact live text, which the repo-only version differs from) and 0251 (needs pgcrypto).
// Anything else failing means a migration file does not apply from scratch.
//   node scripts/sql-tests/chain.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const dir = new URL("../../supabase/migrations/", import.meta.url);
const db = new PGlite({ extensions: {} });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin; create role supabase_admin nologin; create role postgres_stub nologin;
  create schema auth; create schema storage; create schema extensions; create schema realtime;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create function storage.filename(name text) returns text language sql as $$ select name $$;
  create publication supabase_realtime;
  create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
`);
const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
const failed = [];
for (const f of files) {
  if (f.startsWith("0002_")) { try { await db.exec("insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'trainwithronarnold@gmail.com') on conflict do nothing; insert into public.profiles (id, full_name) values ('11111111-1111-1111-1111-111111111111', 'Coach Ron') on conflict do nothing;"); } catch (e) { console.log("seed failed", e.message); } }
  try {
    await db.exec(readFileSync(new URL(f, dir), "utf8").replace(/create extension[^;]*;/gi, ""));
  } catch (e) {
    failed.push([f, String(e.message).split("\n")[0].slice(0, 160)]);
  }
}
console.log(`applied ${files.length - failed.length} of ${files.length}`);
for (const [f, m] of failed) console.log("FAIL", f, "::", m);
