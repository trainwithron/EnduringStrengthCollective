// 0266: columns a client could change on their own rows that only a coach or the server should. Each hole is proven on the live-equivalent
// schema as a real signed-in client, then proven closed, and the legitimate writes are shown still to work.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

async function scene({ db, h }) {
  const coach = await h.user("Guard Coach");
  const ann = await h.user("Guard Ann");
  const bo = await h.user("Guard Bo");
  const org = await h.org(coach);
  const group = await h.group(org, coach, "team", "Guard group");
  await h.member(group, ann);
  await h.member(group, bo);
  await h.asSuper();
  const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id`, [group, coach])).rows[0].id;
  const workout = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'D', 1) returning id`, [prog, group])).rows[0].id;
  const sess = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, status) values ($1, $2, $3, 'completed') returning id`, [workout, group, ann])).rows[0].id;
  const log = (await db.query(`insert into public.workout_logs (session_id, athlete_id, group_id, workout_id, total_volume, total_sets_completed, new_prs) values ($1, $2, $3, $4, 1000, 5, '{}') returning id`, [sess, ann, group, workout])).rows[0].id;
  const post = (await db.query(`insert into public.posts (group_id, author_id, post_type, body) values ($1, $2, 'user_post', 'hello') returning id`, [group, ann])).rows[0].id;
  const msg = (await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'Your plan is ready') returning id`, [group, coach, ann])).rows[0].id;
  const req = (await db.query(`insert into public.training_partner_requests (from_athlete_id, to_athlete_id, message) values ($1, $2, 'hi, text me') returning id`, [bo, ann])).rows[0].id;
  return { coach, ann, bo, org, group, sess, log, post, msg, req };
}

export default {
  name: "0266 client-writable columns that should be coach-only",
  migrations: ["0266"],
  phases: {
    async live({ db, h, state }) {
      const s = await scene({ db, h });
      Object.assign(state, s);
      const asAnn = async (sql, params) => { await h.as(s.ann); return tryQ(db, sql, params); };

      // profiles
      await h.asSuper();
      await db.query(`update public.profiles set intake_required = true where id = $1`, [s.ann]);
      let r = await asAnn(`update public.profiles set intake_required = false, claimed_at = now() where id = $1 returning intake_required, claimed_at`, [s.ann]);
      h.check("baseline: a client can switch off their own waiver gate and mark themselves claimed", r.rows?.[0]?.intake_required === false && r.rows[0].claimed_at !== null, JSON.stringify(r));
      await h.asSuper();
      const stranger = (await db.query(`select gen_random_uuid() as id`)).rows[0].id;
      await db.query(`insert into auth.users (id, email) values ($1, 'new.signup@example.com')`, [stranger]);
      await h.as(stranger);
      r = await tryQ(db, `insert into public.profiles (id, full_name, is_platform_admin) values ($1, 'Fresh signup', true) returning is_platform_admin`, [stranger]);
      h.check("baseline: a brand-new account can create its own profile already marked platform admin (the update-only guard from 0085 does not cover insert)", r.rows?.[0]?.is_platform_admin === true, JSON.stringify(r));
      await h.asSuper();
      await db.query(`delete from public.profiles where id = $1`, [stranger]);
      state.stranger = stranger;

      // client_goals
      r = await asAnn(`insert into public.client_goals (athlete_id, group_id, goal_type, created_by, status, confirmed_at, confirmed_by) values ($1, $2, 'muscle_gain', $1, 'confirmed', now(), $1) returning status`, [s.ann, s.group]);
      h.check("baseline: a client can insert a goal already confirmed, skipping their coach", r.rows?.[0]?.status === "confirmed", JSON.stringify(r));
      await h.asSuper();
      await db.query(`delete from public.client_goals where athlete_id = $1`, [s.ann]);

      // athlete_sessions
      r = await asAnn(`update public.athlete_sessions set is_historical = true, logged_by_coach = true, deduct_session_credit = true where id = $1 returning is_historical`, [s.sess]);
      h.check("baseline: a client can mark their own completed session historical (which turns off the 0236 edit block) and flip coach-logged flags", r.rows?.[0]?.is_historical === true, JSON.stringify(r));
      await h.asSuper();
      await db.query(`update public.athlete_sessions set is_historical = false, logged_by_coach = false, deduct_session_credit = false where id = $1`, [s.sess]);

      // workout_logs
      r = await asAnn(`update public.workout_logs set total_volume = 999999, new_prs = array['Squat','Bench','Deadlift'] where id = $1 returning total_volume`, [s.log]);
      h.check("baseline: a client can rewrite their own workout totals and PR list", Number(r.rows?.[0]?.total_volume) === 999999, JSON.stringify(r));
      await h.asSuper();
      await db.query(`update public.workout_logs set total_volume = 1000, new_prs = '{}' where id = $1`, [s.log]);

      // posts
      r = await asAnn(`update public.posts set channel = 'announcements', pinned_at = now() where id = $1 returning channel, pinned_at`, [s.post]);
      h.check("baseline: a client can move their own post into Announcements and pin it", r.rows?.[0]?.channel === "announcements" && r.rows[0].pinned_at !== null, JSON.stringify(r));
      await h.asSuper();
      await db.query(`update public.posts set channel = 'general', pinned_at = null where id = $1`, [s.post]);

      // direct_messages
      r = await asAnn(`update public.direct_messages set body = 'Your sessions are free this month', sender_id = $2 where id = $1 returning body`, [s.msg, s.bo]);
      h.check("baseline: the recipient of a message can rewrite what it says and who it is from", r.rows?.[0]?.body === "Your sessions are free this month", JSON.stringify(r));
      await h.asSuper();
      await db.query(`update public.direct_messages set body = 'Your plan is ready', sender_id = $2 where id = $1`, [s.msg, s.coach]);

      // training_partner_requests
      r = await asAnn(`update public.training_partner_requests set from_athlete_id = $2, message = 'rewritten' where id = $1 returning message`, [s.req, s.coach]);
      h.check("baseline: the recipient of a partner request can rewrite who it is from and what it says", r.rows?.[0]?.message === "rewritten", JSON.stringify(r));
      await h.asSuper();
      await db.query(`update public.training_partner_requests set from_athlete_id = $2, message = 'hi, text me' where id = $1`, [s.req, s.bo]);
    },

    async "0266"({ db, h, state }) {
      const s = state;
      const asUser = async (uid, sql, params) => { await h.as(uid); return tryQ(db, sql, params); };
      const row = async (sql, params) => { await h.asSuper(); return (await h.one(sql, params)); };

      // profiles
      await h.asSuper();
      await db.query(`update public.profiles set intake_required = true, claimed_at = null where id = $1`, [s.ann]);
      await asUser(s.ann, `update public.profiles set intake_required = false, claimed_at = now(), full_name = 'Ann Renamed' where id = $1`, [s.ann]);
      let p = await row(`select intake_required, claimed_at, full_name from public.profiles where id = $1`, [s.ann]);
      h.check("a client cannot switch off their waiver gate or mark themselves claimed, but can still rename themselves", p.intake_required === true && p.claimed_at === null && p.full_name === "Ann Renamed", JSON.stringify(p));
      await h.asSuper();
      const stranger = (await db.query(`select gen_random_uuid() as id`)).rows[0].id;
      await db.query(`insert into auth.users (id, email) values ($1, 'second.signup@example.com')`, [stranger]);
      let r = await asUser(stranger, `insert into public.profiles (id, full_name, is_platform_admin, intake_required) values ($1, 'Fresh signup', true, true) returning is_platform_admin, intake_required`, [stranger]);
      h.check("a brand-new account's profile is never created as platform admin, and the invite flow's intake_required on insert still works", r.rows?.[0]?.is_platform_admin === false && r.rows[0].intake_required === true, JSON.stringify(r));
      // INSERT is covered as well as UPDATE: admin forced false, claimed marker cleared, waiver gate forced on, whatever the row says.
      await h.asSuper();
      const third = (await db.query(`select gen_random_uuid() as id`)).rows[0].id;
      await db.query(`insert into auth.users (id, email) values ($1, 'third.signup@example.com')`, [third]);
      r = await asUser(third, `insert into public.profiles (id, full_name, is_platform_admin, intake_required, claimed_at) values ($1, 'Sneaky', true, false, now()) returning is_platform_admin, intake_required, claimed_at`, [third]);
      h.check("INSERT guard: a self-created profile with admin true, intake_required false and claimed_at set comes out as admin false, intake_required true, claimed_at null", r.rows?.[0]?.is_platform_admin === false && r.rows[0].intake_required === true && r.rows[0].claimed_at === null, JSON.stringify(r));
      await h.asSuper();
      const fourth = (await db.query(`select gen_random_uuid() as id`)).rows[0].id;
      await db.query(`insert into auth.users (id, email) values ($1, 'fourth.signup@example.com')`, [fourth]);
      await h.asService();
      r = await tryQ(db, `insert into public.profiles (id, full_name, is_platform_admin, intake_required) values ($1, 'Server made', true, false) returning is_platform_admin, intake_required`, [fourth]);
      h.check("INSERT guard: the service role can still create an admin or a profile without the waiver gate (server routes, SQL editor)", r.rows?.[0]?.is_platform_admin === true && r.rows[0].intake_required === false, JSON.stringify(r));
      await h.asService();
      await db.query(`update public.profiles set intake_required = false, claimed_at = now() where id = $1`, [stranger]);
      p = await row(`select intake_required, claimed_at from public.profiles where id = $1`, [stranger]);
      h.check("the server (service role) can still set both", p.intake_required === false && p.claimed_at !== null);

      // client_goals
      r = await asUser(s.ann, `insert into public.client_goals (athlete_id, group_id, goal_type, created_by, status) values ($1, $2, 'muscle_gain', $1, 'confirmed')`, [s.ann, s.group]);
      h.check("a client cannot insert a goal that is already confirmed", !!r.error, JSON.stringify(r));
      r = await asUser(s.ann, `insert into public.client_goals (athlete_id, group_id, goal_type, created_by) values ($1, $2, 'muscle_gain', $1) returning status`, [s.ann, s.group]);
      h.check("a client can still propose a goal (starts proposed)", r.rows?.[0]?.status === "proposed", JSON.stringify(r));
      const goalId = (await row(`select id from public.client_goals where athlete_id = $1`, [s.ann])).id;
      r = await asUser(s.coach, `update public.client_goals set status = 'confirmed', confirmed_at = now(), confirmed_by = $2 where id = $1 returning status`, [goalId, s.coach]);
      h.check("the coach can still confirm it", r.rows?.[0]?.status === "confirmed", JSON.stringify(r));

      // athlete_sessions
      await asUser(s.ann, `update public.athlete_sessions set is_historical = true, logged_by_coach = true, deduct_session_credit = true, athlete_id = $2 where id = $1`, [s.sess, s.bo]);
      let a = await row(`select is_historical, logged_by_coach, deduct_session_credit, athlete_id from public.athlete_sessions where id = $1`, [s.sess]);
      h.check("a client cannot flip the session's historical / coach-logged / credit flags or hand it to someone else", a.is_historical === false && a.logged_by_coach === false && a.deduct_session_credit === false && a.athlete_id === s.ann, JSON.stringify(a));
      r = await asUser(s.ann, `update public.athlete_sessions set session_rpe = 8, status = 'abandoned' where id = $1 returning session_rpe`, [s.sess]);
      h.check("a client can still record effort and abandon a session", r.rows?.[0]?.session_rpe === 8, JSON.stringify(r));
      await asUser(s.coach, `update public.athlete_sessions set is_historical = true where id = $1`, [s.sess]);
      a = await row(`select is_historical from public.athlete_sessions where id = $1`, [s.sess]);
      h.check("the coach can still change them", a.is_historical === true);
      await h.asSuper();
      await db.query(`update public.athlete_sessions set is_historical = false, status = 'completed' where id = $1`, [s.sess]);

      // workout_logs
      await asUser(s.ann, `update public.workout_logs set total_volume = 999999, new_prs = array['Squat'], athlete_id = $2 where id = $1`, [s.log, s.bo]);
      let w = await row(`select total_volume, new_prs, athlete_id from public.workout_logs where id = $1`, [s.log]);
      h.check("a client cannot rewrite their workout totals, PR list or owner", Number(w.total_volume) === 1000 && w.new_prs.length === 0 && w.athlete_id === s.ann, JSON.stringify(w));
      await asUser(s.coach, `update public.workout_logs set total_volume = 1200 where id = $1`, [s.log]);
      w = await row(`select total_volume from public.workout_logs where id = $1`, [s.log]);
      h.check("the coach can still correct them", Number(w.total_volume) === 1200);

      // posts
      r = await asUser(s.ann, `update public.posts set channel = 'announcements' where id = $1`, [s.post]);
      h.check("an author cannot move their own post into Announcements", !!r.error && /Announcements/.test(r.error), JSON.stringify(r));
      await asUser(s.ann, `update public.posts set pinned_at = now(), body = 'edited' where id = $1`, [s.post]);
      let po = await row(`select pinned_at, body from public.posts where id = $1`, [s.post]);
      h.check("an author cannot pin their own post but can edit it", po.pinned_at === null && po.body === "edited", JSON.stringify(po));
      r = await asUser(s.ann, `update public.posts set channel = 'form_checks' where id = $1 returning channel`, [s.post]);
      h.check("an author can still move their post between ordinary channels", r.rows?.[0]?.channel === "form_checks", JSON.stringify(r));
      await asUser(s.coach, `update public.posts set pinned_at = now() where id = $1`, [s.post]);
      po = await row(`select pinned_at from public.posts where id = $1`, [s.post]);
      h.check("the coach can still pin a post", po.pinned_at !== null);

      // direct_messages
      await asUser(s.ann, `update public.direct_messages set body = 'Your sessions are free', sender_id = $2, read_at = now() where id = $1`, [s.msg, s.bo]);
      let m = await row(`select body, sender_id, read_at from public.direct_messages where id = $1`, [s.msg]);
      h.check("a recipient cannot rewrite a message or its sender, but marking it read still works", m.body === "Your plan is ready" && m.sender_id === s.coach && m.read_at !== null, JSON.stringify(m));

      // training_partner_requests
      await asUser(s.ann, `update public.training_partner_requests set from_athlete_id = $2, message = 'rewritten', status = 'accepted' where id = $1`, [s.req, s.coach]);
      let q = await row(`select from_athlete_id, message, status from public.training_partner_requests where id = $1`, [s.req]);
      h.check("a recipient cannot rewrite a partner request, but accepting it still works", q.from_athlete_id === s.bo && q.message === "hi, text me" && q.status === "accepted", JSON.stringify(q));

      // the functions that complete and settle still work as a client
      await h.asSuper();
      const w2 = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) select program_id, group_id, 'D2', 2 from public.workouts where id = (select workout_id from public.athlete_sessions where id = $1) returning id`, [s.sess])).rows[0].id;
      const sess2 = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id) values ($1, $2, $3) returning id`, [w2, s.group, s.ann])).rows[0].id;
      const se = (await db.query(`insert into public.session_exercises (session_id, exercise_name) values ($1, 'Squat') returning id`, [sess2])).rows[0].id;
      await db.query(`insert into public.set_logs (session_exercise_id, set_order, weight, reps, status) values ($1, 1, 100, 5, 'completed')`, [se]);
      await h.as(s.ann);
      const done = (await h.rows(`select * from public.complete_workout_session($1)`, [sess2]))[0];
      h.check("a client can still complete a workout through the function (the guard does not break it)", !!done && Number(done.total_volume) === 500, JSON.stringify(done));
    },
  },
};
