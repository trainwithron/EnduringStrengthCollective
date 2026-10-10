// 0329 (Release AA): every session costs exactly 1 credit, and the waitlist offer words the time in the coach's zone.
export default {
  name: "0329 every session costs exactly 1 credit; the waitlist offer uses the coach's time zone",
  migrations: ["0329"],
  phases: {
    async "0329"({ db, h }) {
      const coach = await h.user("AA Coach");
      const ann = await h.user("AA Ann");
      const bo = await h.user("AA Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "AA group");
      await h.member(group, ann);
      await h.member(group, bo);

      // ---- a session type can only cost 1
      await h.asSuper();
      const ok = await db.query(`insert into public.session_types (coach_id, name) values ($1, 'Practice') returning credit_cost`, [coach]);
      h.check("a new session type costs 1 without anyone setting it", ok.rows[0].credit_cost === 1);
      await h.expectError("a session type cannot cost 0", () => db.query(`insert into public.session_types (coach_id, name, credit_cost) values ($1, 'Free', 0)`, [coach]), /session_types_credit_cost_is_one|check/i);
      await h.expectError("a session type cannot cost 2", () => db.query(`insert into public.session_types (coach_id, name, credit_cost) values ($1, 'Double', 2)`, [coach]), /session_types_credit_cost_is_one|check/i);
      const src = (await h.one(`select prosrc from pg_proc where proname = 'complete_workout_session' and pronamespace = 'public'::regnamespace`)).prosrc;
      h.check("completing a workout no longer reads a session type's cost", !/select\s+credit_cost\s+into/i.test(src) && /v_credit_cost := 1;/.test(src));
      h.check("completing a workout still locks the session and is safe to repeat (the live behaviour is kept)", /for update/.test(src) && /status = 'completed'/.test(src));

      // ---- a coach-logged workout of a typed session settles exactly one credit
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id`, [group, coach])).rows[0].id;
      const workout = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1) returning id`, [prog, group])).rows[0].id;
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5)`, [ann, group]);
      const typeId = ok.rows[0] ? (await h.one(`select id from public.session_types where coach_id = $1 and name = 'Practice'`, [coach])).id : null;
      const sess = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, deduct_session_credit, session_type_id) values ($1, $2, $3, true, true, $4) returning id`, [workout, group, ann, typeId])).rows[0].id;
      await h.as(coach);
      const r1 = (await h.rows(`select * from public.complete_workout_session($1)`, [sess]))[0];
      const r2 = (await h.rows(`select * from public.complete_workout_session($1)`, [sess]))[0];
      await h.asSuper();
      const bal = (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [ann, group])).balance;
      h.check("a coach-logged typed session takes exactly 1 credit", bal === 4 && r1.credit_consumed === true, `balance ${bal}`);
      h.check("finishing twice does not take a second one", r2.credit_consumed === false && bal === 4);

      // ---- the waitlist offer words the time in the coach's zone
      await h.asSuper();
      await db.query(`update public.profiles set timezone = 'America/Los_Angeles' where id = $1`, [coach]);
      const start = "2026-10-12T02:00:00Z"; // 7:00 PM on Oct 11 in Los Angeles
      await db.query(`insert into public.booking_waitlist_entries (coach_id, athlete_id, group_id, slot_start_at, slot_end_at) values ($1, $2, $3, $4, $5)`, [coach, bo, group, start, "2026-10-12T03:00:00Z"]);
      await h.asService();
      await db.query(`select public.offer_freed_slot_to_waitlist($1, $2, $3)`, [coach, start, "2026-10-12T03:00:00Z"]);
      await h.asSuper();
      const note = await h.one(`select body, link_path from public.notifications where profile_id = $1 and type = 'waitlist_slot_offered' order by created_at desc limit 1`, [bo]);
      h.check("the offered time is on the coach's clock (7:00 PM, not 02:00 AM UTC)", /Sun Oct 11, 07:00 PM/.test(note.body), note.body);
      h.check("the link's date is the coach's date (Oct 11, not Oct 12)", note.link_path.endsWith("/calendar/2026-10-11"), note.link_path);
      h.check("the offer text keeps its dash (written with chr(8212), no odd characters)", note.body.includes("— book now"), note.body);

      // A coach with no saved zone, or a wrong one, gets the platform default instead of an error.
      await db.query(`update public.profiles set timezone = 'Not/AZone' where id = $1`, [coach]);
      await db.query(`update public.booking_waitlist_entries set status = 'waiting' where athlete_id = $1`, [bo]);
      await h.asService();
      await db.query(`select public.offer_freed_slot_to_waitlist($1, $2, $3)`, [coach, start, "2026-10-12T03:00:00Z"]);
      await h.asSuper();
      const note2 = await h.one(`select body from public.notifications where profile_id = $1 and type = 'waitlist_slot_offered' order by created_at desc limit 1`, [bo]);
      h.check("an unknown zone falls back to New York (10:00 PM on Oct 11 there)", /Sun Oct 11, 10:00 PM/.test(note2.body), note2.body);

      // The permissions did not change.
      const acl = await h.one(`select has_function_privilege('anon', 'public.offer_freed_slot_to_waitlist(uuid, timestamptz, timestamptz)', 'execute') as a, has_function_privilege('authenticated', 'public.offer_freed_slot_to_waitlist(uuid, timestamptz, timestamptz)', 'execute') as b, has_function_privilege('anon', 'public.complete_workout_session(uuid)', 'execute') as c`);
      h.check("the waitlist function is still not runnable by signed-in users or visitors, and completing a workout still not by visitors", acl.a === false && acl.b === false && acl.c === false, JSON.stringify(acl));
    },
  },
};
