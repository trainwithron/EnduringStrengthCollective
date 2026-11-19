// Migration 0452 (starred meals) in an in-memory Postgres, set up the way the live favorites table is today (0048 + 0286): the paste runs (and runs again), a coach stars and
// reads only their own meals, a meal needs a name and the meal itself, favorite foods keep their rules, the cap is 200, the coach recipes are carried over (ingredient names kept,
// the recipe untouched), and the undo puts it back. Run: node scripts/sql-tests/starred-meals.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8").split("\r\n").join("\n");
const paste = file("apply/apply-step207-0452.sql");
const undo = file("apply/undo-step207-0452.sql");
const RON = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table public.profiles (id uuid primary key);
  insert into public.profiles values ('${RON}'), ('${OTHER}');
  create table public.recipe_favorites (profile_id uuid not null references public.profiles(id) on delete cascade, recipe_id text not null, created_at timestamptz not null default now(), primary key (profile_id, recipe_id));
  alter table public.recipe_favorites enable row level security;
  create policy recipe_favorites_own on public.recipe_favorites for all to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
  grant select, insert, update, delete on public.recipe_favorites to authenticated;
  create table public.recipes (id uuid primary key default gen_random_uuid(), created_by uuid not null references public.profiles(id), name text not null, reference_macros jsonb);
  create table public.recipe_ingredients (id uuid primary key default gen_random_uuid(), recipe_id uuid references public.recipes(id) on delete cascade, sort_order int not null default 0, label text);
`);
await db.exec(file("migrations/0286_food_favorites.sql"));
await db.exec(`
  insert into public.recipes (id, created_by, name, reference_macros) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '${OTHER}', 'New Recipe', null),
    ('aaaaaaaa-0000-0000-0000-000000000002', '${RON}', '  Steak   and Rice ', '{"protein": 52, "carbs": 70, "fat": 28, "kcal": 740}');
  insert into public.recipe_ingredients (recipe_id, sort_order, label) values ('aaaaaaaa-0000-0000-0000-000000000002', 2, 'Rice'), ('aaaaaaaa-0000-0000-0000-000000000002', 1, 'Sirloin');
  insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories) values ('${RON}', 'food:apple', 'food', 'Apple', 95);
`);

const checkRow = async () => {
  const res = await db.query(paste.slice(paste.indexOf("-- Check: one row, all true.")));
  assert.equal(res.rows.length, 1);
  return res.rows[0];
};
await db.exec(paste);
assert.ok(Object.values(await checkRow()).every((v) => v === true), JSON.stringify(await checkRow()));
assert.equal(Object.keys(await checkRow()).length, 7);
await db.exec(paste); // re-running is safe
assert.ok(Object.values(await checkRow()).every((v) => v === true));

// carried over: each recipe for the coach who made it, ingredient names in order, the recipe untouched
const carried = (await db.query(`select profile_id, recipe_id, label, calories::float c, protein_g::float p, meal from public.recipe_favorites where kind = 'meal' order by label`)).rows;
assert.equal(carried.length, 2);
assert.deepEqual(carried.map((r) => [r.profile_id, r.recipe_id, r.label]), [[OTHER, "meal:new recipe", "New Recipe"], [RON, "meal:steak and rice", "Steak   and Rice"]]);
assert.equal(carried[0].c, null);
assert.deepEqual(carried[0].meal.ingredients, []);
assert.equal(carried[1].c, 740);
assert.equal(carried[1].p, 52);
assert.deepEqual(carried[1].meal.ingredients, ["Sirloin", "Rice"]);
assert.equal(carried[1].meal.key, "r:aaaaaaaa-0000-0000-0000-000000000002");
assert.equal((await db.query(`select count(*)::int n from public.recipes`)).rows[0].n, 2);

async function as(user, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}
const fails = (user, sql) => assert.rejects(() => as(user, sql));

// a coach stars a meal and sees only their own
await as(RON, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories, protein_g, meal) values ('${RON}', 'meal:oats', 'meal', 'Oats', 400, 30, '{"recipeName": "Oats", "ingredients": []}')`);
assert.equal((await as(RON, `select count(*)::int n from public.recipe_favorites where kind = 'meal'`)).rows[0].n, 2);
assert.equal((await as(OTHER, `select count(*)::int n from public.recipe_favorites where kind = 'meal'`)).rows[0].n, 1);
await fails(OTHER, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, meal) values ('${RON}', 'meal:x', 'meal', 'X', '{}')`);
await fails(null, `select * from public.recipe_favorites`);
// a meal needs a name and the meal; macros may be blank but never negative
await fails(RON, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, meal) values ('${RON}', 'meal:a', 'meal', ' ', '{}')`);
await fails(RON, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label) values ('${RON}', 'meal:b', 'meal', 'B')`);
await fails(RON, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, meal) values ('${RON}', 'meal:c', 'meal', 'C', '[]')`);
await fails(RON, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories, meal) values ('${RON}', 'meal:d', 'meal', 'D', -1, '{}')`);
// favorite foods keep their rule (calories required)
await fails(RON, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label) values ('${RON}', 'food:pear', 'food', 'Pear')`);
// the cap: 200 starred meals
await db.exec(`insert into public.recipe_favorites (profile_id, recipe_id, kind, label, meal) select '${OTHER}', 'meal:n' || g, 'meal', 'N' || g, '{}' from generate_series(1, 199) g`);
await assert.rejects(() => db.exec(`insert into public.recipe_favorites (profile_id, recipe_id, kind, label, meal) values ('${OTHER}', 'meal:one-more', 'meal', 'One more', '{}')`), /200 starred meals/);

// the undo puts it back
await db.exec(undo);
assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name = 'recipe_favorites' and column_name = 'meal'`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from public.recipe_favorites`)).rows[0].n, 1);
await assert.rejects(() => db.exec(`insert into public.recipe_favorites (profile_id, recipe_id, kind, label) values ('${RON}', 'x', 'meal', 'X')`));
console.log("starred meals: ok");
