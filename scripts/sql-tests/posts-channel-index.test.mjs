// Rehearses step 222 (migration 0466): the feed's channel index on posts. On an in-memory Postgres with a posts stand-in (the live columns it needs, and the live
// idx_posts_group_created beside it): the migration twice (re-running is safe), the paste's check all true, the undo's check all true and the index gone, the paste again.
// The feed's reads give the same rows with or without it (it is only for speed).
//   node scripts/sql-tests/posts-channel-index.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const lf = (s) => s.split(CRLF).join(LF);
const read = (p) => lf(readFileSync(new URL(p, import.meta.url), "utf8"));
const db = new PGlite();
const failures = [];
const expect = (name, cond) => {
  if (!cond) failures.push(name);
};

await db.exec(`
  create table public.posts (id uuid primary key default gen_random_uuid(), group_id uuid not null, channel text not null default 'general', body text, pinned_at timestamptz, created_at timestamptz not null default now());
  create index idx_posts_group_created on public.posts (group_id, created_at desc);
  insert into public.posts (group_id, channel, body, created_at)
    select ('00000000-0000-0000-0000-00000000000' || (g % 3))::uuid, (array['announcements', 'form_checks', 'pr_board', 'general', 'team_chat'])[1 + (g % 5)], 'post ' || g, now() - (g || ' minutes')::interval
      from generate_series(1, 300) g;
`);

const G = "00000000-0000-0000-0000-000000000001";
// the feed's two reads: is there a post in this channel, and a channel's newest posts (General listing Team Chat too)
const reads = async () =>
  JSON.stringify([
    (await db.query(`select id from public.posts where group_id = $1 and channel = 'pr_board' limit 1`, [G])).rows.length,
    (await db.query(`select body from public.posts where group_id = $1 and channel in ('general', 'team_chat') order by pinned_at desc nulls last, created_at desc limit 30`, [G])).rows.map((r) => r.body),
  ]);
const before = await reads();

const migration = read("../../supabase/migrations/0466_posts_group_channel_index.sql");
await db.exec(migration);
await db.exec(migration);
const count = async () => (await db.query(`select count(*)::int n from pg_indexes where schemaname = 'public' and indexname = 'posts_group_channel_created'`)).rows[0].n;
expect("migration: the index is made once, and running it again is safe", (await count()) === 1);
expect("the feed's reads give the same rows with the index", (await reads()) === before);

const apply = read("../../supabase/apply/apply-step222-0466.sql");
const undo = read("../../supabase/apply/undo-step222-0466.sql");
const ascii = (s) => [...s].every((c) => c.charCodeAt(0) < 128);
expect("paste: holds the migration word for word", apply.includes(migration.trimEnd()));
expect("paste and undo: plain ASCII", ascii(apply) && ascii(undo));
const lastRow = (results) => results[results.length - 1].rows;
const oneRowAllTrue = (rows) => rows.length === 1 && Object.values(rows[0]).length > 0 && Object.values(rows[0]).every((v) => v === true);

expect("paste: check row is one row, all true", oneRowAllTrue(lastRow(await db.exec(apply))));
expect("paste: still one index", (await count()) === 1);
expect("undo: check row is one row, all true", oneRowAllTrue(lastRow(await db.exec(undo))));
expect("undo: the index is gone", (await count()) === 0);
expect("undo: the other posts index is untouched", (await db.query(`select 1 from pg_indexes where indexname = 'idx_posts_group_created'`)).rows.length === 1);
expect("the feed's reads give the same rows without it", (await reads()) === before);
// the paste's check is not fooled: without the index it says false
const noIndex = (await db.query(apply.slice(apply.indexOf("-- Check: one row, all true.")))).rows[0];
expect("paste check says false when the index is missing", Object.values(noIndex).every((v) => v === false));
expect("paste: applies again after the undo, all true", oneRowAllTrue(lastRow(await db.exec(apply))));
expect("paste: one index after re-applying", (await count()) === 1);

if (failures.length) {
  console.error("FAILED:" + LF + "- " + failures.join(LF + "- "));
  process.exit(1);
}
console.log("OK: step 222 rehearsal passed");
