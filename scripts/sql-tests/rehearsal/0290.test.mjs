// 0290 (Release F): a membership cannot be handed to another person; the two AI-credit spending functions are server-only and refuse negative amounts; two private
// video buckets are readable only by the person they belong to and the coaches; a client who creates their own profile is marked as signed in (and people who
// already did are backfilled).
import { readFileSync } from "node:fs";

const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0290 Release F security closures",
  migrations: ["0290"],
  phases: {
    async "0289"({ db, h }) {
      const coach = await h.user("F1 Coach");
      const ann = await h.user("F1 Ann");
      const bob = await h.user("F1 Bob");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "F1 group");
      await h.member(group, ann);
      await h.as(coach);
      const swap = await tryQ(db, `update public.group_memberships set profile_id = $1 where group_id = $2 and profile_id = $3 returning id`, [bob, group, ann]);
      await h.asSuper();
      h.check("baseline: before 0290 a coach can re-point a membership at someone else", !swap.error && (swap.rows ?? []).length === 1, JSON.stringify(swap));
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [group, bob]);
      const c = await h.one(`select coach_id from public.coach_credits limit 1`).catch(() => null);
      await h.as(coach);
      const neg = await tryQ(db, `select * from public.spend_coach_credits($1, -100)`, [coach]);
      await h.asSuper();
      h.check("baseline: before 0290 a signed-in coach can call spend_coach_credits with a negative cost", !neg.error, JSON.stringify(neg));
    },

    async "0290"({ db, h }) {
      const coach = await h.user("F2 Coach");
      const ann = await h.user("F2 Ann");
      const bob = await h.user("F2 Bob");
      const cat = await h.user("F2 Cat");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "F2 group");
      await h.member(group, ann);
      await h.member(group, bob);

      // 1. membership identity
      await h.as(coach);
      const swap = await tryQ(db, `update public.group_memberships set profile_id = $1 where group_id = $2 and profile_id = $3 returning id`, [cat, group, ann]);
      const role = await tryQ(db, `update public.group_memberships set client_tier = client_tier, role = role where group_id = $1 and profile_id = $2 returning id`, [group, ann]);
      await h.asSuper();
      h.check("a coach cannot re-point a membership at another person", /cannot be handed to another person/.test(swap.error ?? ""), JSON.stringify(swap));
      h.check("a coach can still edit the other columns of a membership", !role.error && (role.rows ?? []).length === 1, JSON.stringify(role));
      await h.asService();
      const svc = await tryQ(db, `update public.group_memberships set profile_id = $1 where group_id = $2 and profile_id = $3 returning id`, [cat, group, bob]);
      await h.asSuper();
      h.check("the server (service role) is not blocked by the guard", !svc.error && (svc.rows ?? []).length === 1, JSON.stringify(svc));

      // 2 + 3. AI credit functions
      await db.query(`insert into public.coach_credits (coach_id, balance) values ($1, 10) on conflict (coach_id) do update set balance = 10`, [coach]);
      await h.as(coach);
      const a1 = await tryQ(db, `select * from public.spend_coach_credits($1, -100)`, [coach]);
      const a2 = await tryQ(db, `select * from public.spend_ai_action($1, 'program_generation', 3, 1000000)`, [coach]);
      await h.asSuper();
      h.check("a signed-in coach can no longer run spend_coach_credits", /permission denied/i.test(a1.error ?? ""), JSON.stringify(a1));
      h.check("a signed-in coach can no longer run spend_ai_action (the browser cannot choose the allowance or cost)", /permission denied/i.test(a2.error ?? ""), JSON.stringify(a2));
      await h.asService();
      const n1 = await tryQ(db, `select * from public.spend_coach_credits($1, -100)`, [coach]);
      const n2 = await tryQ(db, `select * from public.spend_ai_action($1, 'program_generation', -3, 0)`, [coach]);
      const n3 = await tryQ(db, `select * from public.spend_ai_action($1, 'program_generation', 3, -1)`, [coach]);
      const ok1 = await tryQ(db, `select * from public.spend_coach_credits($1, 2)`, [coach]);
      const ok2 = await tryQ(db, `select * from public.spend_ai_action($1, 'program_generation', 3, 0)`, [coach]);
      await h.asSuper();
      const bal = (await h.one(`select balance from public.coach_credits where coach_id = $1`, [coach])).balance;
      h.check("spend_coach_credits refuses a negative cost even from the server", /zero or more/.test(n1.error ?? ""), JSON.stringify(n1));
      h.check("spend_ai_action refuses a negative cost or allowance", /Invalid amount/.test(n2.error ?? "") && /Invalid amount/.test(n3.error ?? ""), JSON.stringify({ n2, n3 }));
      h.check("the server can still spend: 2 then 3 credits off a balance of 10 leaves 5", !ok1.error && ok1.rows?.[0]?.spent === true && !ok2.error && ok2.rows?.[0]?.source === "credits" && bal === 5, JSON.stringify({ ok1, ok2, bal }));

      // 4. private video buckets
      await db.exec(`alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select on storage.objects to authenticated`);
      const objs = {
        annVideo: `${group}/se-1/ann.webm`,
        checkinForAnn: `${group}/${ann}/c1.webm`,
        checkinForCat: `${group}/${cat}/c2.webm`,
      };
      await db.query(`insert into storage.objects (bucket_id, name, owner) values ('athlete-exercise-videos', $1, $2), ('coach-video-checkins', $3, $4), ('coach-video-checkins', $5, $4)`, [objs.annVideo, ann, objs.checkinForAnn, coach, objs.checkinForCat]);
      const seeAs = async (uid, bucket) => { await h.as(uid); const r = await tryQ(db, `select name from storage.objects where bucket_id = $1 order by name`, [bucket]); await h.asSuper(); if (r.error) console.log("SEE ERROR", r.error); return (r.rows ?? []).map((x) => x.name); };
      const annSeesVideos = await seeAs(ann, "athlete-exercise-videos");
      const bobSeesVideos = await seeAs(bob, "athlete-exercise-videos");
      const coachSeesVideos = await seeAs(coach, "athlete-exercise-videos");
      h.check("an athlete can open their own form-check video", annSeesVideos.length === 1, JSON.stringify(annSeesVideos));
      h.check("another athlete in the group cannot see it", bobSeesVideos.length === 0, JSON.stringify(bobSeesVideos));
      h.check("the group's coach can see it", coachSeesVideos.length === 1, JSON.stringify(coachSeesVideos));
      const annSeesCheckins = await seeAs(ann, "coach-video-checkins");
      const catSeesCheckins = await seeAs(cat, "coach-video-checkins");
      const coachSeesCheckins = await seeAs(coach, "coach-video-checkins");
      h.check("an athlete sees only the video check-in addressed to them", annSeesCheckins.length === 1 && annSeesCheckins[0] === objs.checkinForAnn, JSON.stringify(annSeesCheckins));
      h.check("another person sees only the check-in addressed to them", catSeesCheckins.every((n) => n === objs.checkinForCat), JSON.stringify(catSeesCheckins));
      h.check("the coach sees every check-in of their group", coachSeesCheckins.length === 2, JSON.stringify(coachSeesCheckins));
      await db.exec(`alter table storage.objects disable row level security; delete from storage.objects where bucket_id in ('athlete-exercise-videos', 'coach-video-checkins')`);

      // 5. a person creating their own profile is marked claimed; coach-created accounts (server insert) are not; the backfill stamps only people who have signed in
      await db.query(`insert into auth.users (id, email) values ($1, 'new.self@example.com')`, [h.uuid(901)]);
      await h.as(h.uuid(901));
      const own = await tryQ(db, `insert into public.profiles (id, full_name, is_platform_admin, claimed_at, intake_required) values ($1, 'New Self', true, null, false) returning is_platform_admin, intake_required, claimed_at`, [h.uuid(901)]);
      await h.asSuper();
      h.check("a self-signup profile is stamped claimed, still cannot be admin or switch the waiver off", !own.error && own.rows?.[0]?.claimed_at !== null && own.rows[0].is_platform_admin === false && own.rows[0].intake_required === true, JSON.stringify(own));
      await db.query(`insert into auth.users (id, email) values ($1, 'made.by.coach@pending.invalid')`, [h.uuid(902)]);
      await h.asService();
      const made = await tryQ(db, `insert into public.profiles (id, full_name, claimed_at, intake_required) values ($1, 'Made By Coach', null, true) returning claimed_at`, [h.uuid(902)]);
      await h.asSuper();
      h.check("a profile the server creates for a client keeps claimed_at empty", !made.error && made.rows?.[0]?.claimed_at === null, JSON.stringify(made));

      await db.query(`insert into auth.users (id, email, last_sign_in_at) values ($1, 'signed.in@example.com', now() - interval '2 days'), ($2, 'never@example.com', null), ($3, 'placeholder@pending.invalid', now())`, [h.uuid(903), h.uuid(904), h.uuid(905)]);
      await db.query(`insert into public.profiles (id, full_name, claimed_at) values ($1, 'Signed In', null), ($2, 'Never', null), ($3, 'Placeholder', null)`, [h.uuid(903), h.uuid(904), h.uuid(905)]);
      const file = readFileSync(new URL("../../../supabase/migrations/0290_release_f_security_guards.sql", import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
      await db.exec(file.slice(file.indexOf("update public.profiles p")));
      const rows = await h.rows(`select id, claimed_at is not null as claimed from public.profiles where id = any($1::uuid[]) order by full_name`, [[h.uuid(903), h.uuid(904), h.uuid(905)]]);
      const byName = Object.fromEntries(rows.map((r) => [r.id, r.claimed]));
      h.check("the backfill stamps someone who has signed in", byName[h.uuid(903)] === true, JSON.stringify(rows));
      h.check("...and leaves someone who has never signed in, and a placeholder account, alone", byName[h.uuid(904)] === false && byName[h.uuid(905)] === false, JSON.stringify(rows));
    },
  },
};
