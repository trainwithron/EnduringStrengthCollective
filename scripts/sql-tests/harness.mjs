// Shared pieces for the migration rehearsal: an in-memory Postgres (PGlite) with small stand-ins for the Supabase parts (auth, storage,
// realtime), the live-equivalent schema (every migration the live database already has), and the pending migrations applied one by one in the
// planned order. Used by rehearsal.mjs.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";

const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);
const fixturesDir = new URL("./fixtures/", import.meta.url);

export const OWNER_ID = "11111111-1111-1111-1111-111111111111";

// What the live database has today (read from supabase_migrations on 2026-10-05): everything through 0235, plus these.
export const LIVE_EXTRA = ["0239", "0243", "0245", "0246", "0247"];

// The order Ron is asked to apply the pending ones (a3_worktree_local_work_and_migration_order_oct5.md). 0238, 0252 and 0253 go last, after
// the invite-join smoke test, because they close access the old code still uses.
export const PLAN_ORDER = [
  "0248", "0249", "0250", "0251", "0254", "0240", "0241", "0237", "0242", "0236", "0244",
  "0255", "0256", "0257", "0258", "0259", "0260", "0261", "0262", "0263", "0264", "0265", "0266", "0267", "0268", "0269",
  "0238", "0252", "0253",
  // After 0238: live already has 0238 applied, and 0238 re-creates the membership insert policy that 0270 tightens.
  "0270",
  // Closes function permissions (0271), then the two public forms once their server routes are live (0272).
  "0271", "0272",
  "0273", "0274", "0275", "0276", "0277", "0278", "0279", "0280", "0281", "0282", "0283", "0284", "0285", "0286", "0287", "0288", "0289", "0290", "0291", "0292", "0293", "0294", "0295", "0296", "0297", "0298", "0299", "0300", "0301", "0302", "0303", "0304", "0305", "0306", "0307", "0308", "0309", "0310", "0311", "0312", "0313",
];

export function migrationFile(prefix) {
  const f = readdirSync(migrationsDir).find((x) => x.startsWith(prefix + "_"));
  if (!f) throw new Error("no migration file for " + prefix);
  return f;
}

// Line endings are normalized: on Windows git checks files out with CRLF, and a function body kept with CRLF has a different text (and md5) than the live one.
const readSql = (file) => readFileSync(new URL(file, migrationsDir), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).replace(/create extension[^;]*;/gi, "");

export async function createDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_admin nologin;
    create schema auth; create schema storage; create schema extensions; create schema realtime;
    create extension pgcrypto with schema extensions;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    create function storage.filename(name text) returns text language sql as $$ select name $$;
    create publication supabase_realtime;
    create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    grant usage on schema public, auth, extensions to anon, authenticated, service_role;
    -- Supabase hands every API role privileges on tables and functions created in public; row security and the migrations' own
    -- grants and revokes decide what is actually allowed.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  return db;
}

// Applies the live-equivalent schema. Returns notes about files that did not apply from the repo (drift between repo and live).
export async function applyLiveEquivalent(db) {
  const notes = [];
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    const n = f.slice(0, 4);
    const isLive = Number(n) <= 235 || LIVE_EXTRA.includes(n);
    if (!isLive) continue;
    if (n === "0002") {
      await db.exec(`insert into auth.users (id, email) values ('${OWNER_ID}', 'trainwithronarnold@gmail.com') on conflict do nothing;
                     insert into public.profiles (id, full_name) values ('${OWNER_ID}', 'Coach Ron') on conflict do nothing;`);
    }
    try {
      await db.exec(readSql(f));
    } catch (e) {
      notes.push(`${f}: ${String(e.message).split("\n")[0].slice(0, 140)}`);
    }
  }
  // The repo's text of this function differs from live; 0236 and 0248 patch it by exact text, so use the live definition.
  await db.exec(readFileSync(new URL("complete_workout_session.live.sql", fixturesDir), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)));
  // The live database has a second, identical recompute trigger on set_logs that no repo migration creates (found by reading live read-only).
  await db.exec("create trigger trg_recompute_workout_log after insert or update or delete on public.set_logs for each row execute function public.recompute_workout_log()");
  return notes;
}

// Applies one pending migration; returns { ok, error }.
export async function applyOne(db, prefix) {
  try {
    await db.exec(readSql(migrationFile(prefix)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message).split("\n")[0].slice(0, 200) };
  }
}

export function makeHelpers(db) {
  const results = [];
  let current = "";
  const api = {
    results,
    section(name) { current = name; console.log(`\n== ${name}`); },
    check(name, cond, extra = "") {
      console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && extra ? " :: " + extra : ""}`);
      results.push({ section: current, name, ok: !!cond });
    },
    // Run the following statements as this signed-in user, as the signed-out visitor (null), as the service role, or as the superuser.
    async as(uid) {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); select set_config('request.jwt.claim.role', '${uid ? "authenticated" : "anon"}', false); set role ${uid ? "authenticated" : "anon"}`);
    },
    async asService() {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', 'service_role', false); set role service_role`);
    },
    async asSuper() {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false)`);
    },
    async one(sql, p) { return (await db.query(sql, p)).rows[0]; },
    async rows(sql, p) { return (await db.query(sql, p)).rows; },
    async expectError(name, fn, pattern) {
      try {
        await fn();
        api.check(name, false, "no error");
      } catch (e) {
        api.check(name, pattern.test(String(e.message)), String(e.message).split("\n")[0]);
      }
    },
    async expectErrorAs(uid, name, sql, params, pattern) {
      await api.as(uid);
      return api.expectError(name, () => db.query(sql, params), pattern);
    },
    // Seed helpers (run as the superuser, so row security does not get in the way of setting a scene).
    async user(name) {
      await api.asSuper();
      const id = (await db.query("select gen_random_uuid() as id")).rows[0].id;
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, name.toLowerCase().replace(/[^a-z0-9]+/g, ".") + "@example.com"]);
      await db.query("insert into public.profiles (id, full_name) values ($1, $2) on conflict (id) do update set full_name = excluded.full_name", [id, name]);
      return id;
    },
    // The platform-admin flag is guarded by a trigger (0085) that only lets the service role change it.
    async platformAdmin(name) {
      const id = await api.user(name);
      await api.asService();
      await db.query("update public.profiles set is_platform_admin = true where id = $1", [id]);
      await api.asSuper();
      return id;
    },
    async org(ownerId, name = "Org") {
      await api.asSuper();
      const slug = "org-" + Math.random().toString(36).slice(2, 9);
      const id = (await db.query("insert into public.organizations (slug, name, owner_id) values ($1, $2, $3) returning id", [slug, name, ownerId])).rows[0].id;
      await db.query("insert into public.organization_memberships (organization_id, profile_id, role) values ($1, $2, 'owner') on conflict do nothing", [id, ownerId]);
      return id;
    },
    async orgMember(orgId, profileId, role = "coach") {
      await api.asSuper();
      await db.query("insert into public.organization_memberships (organization_id, profile_id, role) values ($1, $2, $3) on conflict do nothing", [orgId, profileId, role]);
    },
    async group(orgId, coachId, kind = "team", name = "Group") {
      await api.asSuper();
      const id = (await db.query("insert into public.groups (name, created_by, organization_id, group_kind) values ($1, $2, $3, $4) returning id", [name, coachId, orgId, kind])).rows[0].id;
      await db.query("insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [id, coachId]);
      return id;
    },
    async member(groupId, profileId, role = "athlete") {
      await api.asSuper();
      await db.query("insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, $3)", [groupId, profileId, role]);
    },
    uuid(n) { return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`; },
  };
  return api;
}
