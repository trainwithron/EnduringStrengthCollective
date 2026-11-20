// Rehearses step 212 (migration 0456, discard_imported_one_on_one_space) on an in-memory Postgres with a small stand-in schema: the space is deleted only when nothing but the coach's seat and the
// client's intake points at it; any other row (a booking here), another member, a team space, an old space or someone else's space keeps it; a restricted delete returns false and deletes nothing.
//   node scripts/sql-tests/discard-imported-space.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create table public.groups (id uuid primary key, created_by uuid, created_at timestamptz default now(), group_kind text, next_season_id uuid references public.groups(id) on delete set null);
  create table public.group_memberships (group_id uuid references public.groups(id) on delete cascade, profile_id uuid, role text);
  create table public.client_intake (id serial primary key, group_id uuid references public.groups(id) on delete cascade);
  create table public.bookings (id serial primary key, group_id uuid references public.groups(id) on delete cascade);
  create table public.credit_purchases (id serial primary key, group_id uuid references public.groups(id));
`);
await db.exec(readFileSync(new URL("../../supabase/migrations/0456_discard_imported_space.sql", import.meta.url), "utf8"));

const coach = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";
let n = 0;
const space = async (opts = {}) => {
  n++;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await db.query(`insert into public.groups (id, created_by, created_at, group_kind) values ($1, $2, $3, $4)`, [id, opts.by ?? coach, opts.at ?? new Date().toISOString(), opts.kind ?? "one_on_one"]);
  await db.query(`insert into public.group_memberships values ($1, $2, 'coach')`, [id, opts.by ?? coach]);
  return id;
};
const discard = async (id, by = coach) => (await db.query(`select public.discard_imported_one_on_one_space($1, $2) as ok`, [id, by])).rows[0].ok;
const exists = async (id) => (await db.query(`select 1 from public.groups where id = $1`, [id])).rows.length > 0;
const failures = [];
const expect = (name, cond) => { if (!cond) failures.push(name); };

const empty = await space();
await db.query(`insert into public.client_intake (group_id) values ($1)`, [empty]);
expect("an empty space (coach seat + intake only) is deleted", (await discard(empty)) === true && !(await exists(empty)));

const booked = await space();
await db.query(`insert into public.bookings (group_id) values ($1)`, [booked]);
expect("a space with a booking is kept", (await discard(booked)) === false && (await exists(booked)));

const crowded = await space();
await db.query(`insert into public.group_memberships values ($1, $2, 'athlete')`, [crowded, other]);
expect("a space with someone else in it is kept", (await discard(crowded)) === false && (await exists(crowded)));

const team = await space({ kind: "team" });
expect("a team space is kept", (await discard(team)) === false && (await exists(team)));

const old = await space({ at: new Date(Date.now() - 2 * 86400000).toISOString() });
expect("a space older than a day is kept", (await discard(old)) === false && (await exists(old)));

const theirs = await space({ by: other });
expect("another coach's space is kept", (await discard(theirs, coach)) === false && (await exists(theirs)));

const paid = await space();
await db.query(`insert into public.credit_purchases (group_id) values ($1)`, [paid]);
expect("a space a purchase points at is kept", (await discard(paid)) === false && (await exists(paid)));

expect("an unknown space returns false", (await discard("99999999-9999-9999-9999-999999999999")) === false);

if (failures.length) {
  console.error("FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("OK: discard_imported_one_on_one_space rehearsal passed (8 cases)");
