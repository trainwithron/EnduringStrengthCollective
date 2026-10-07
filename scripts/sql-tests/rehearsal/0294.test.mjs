// 0294: food preferences (one row per CLIENT), the protein target and floor, a fixed-wording notice to the coaches when allergies or dislikes change, the client's
// answer to "are you happy with your meal plan?", and two new notification types added to the list the database already has.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0294 food preferences, protein floor, allergy notices, feedback",
  migrations: ["0294"],
  phases: {
    async "0293"({ db, h }) {
      const t = await h.one(`select to_regclass('public.client_nutrition_preferences') is not null as prefs, to_regclass('public.client_nutrition_feedback') is not null as fb`);
      h.check("baseline: neither table exists yet", !t.prefs && !t.fb, JSON.stringify(t));
      const c = await h.one(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_type_check'`);
      h.check("baseline: the notification types do not include the new ones", !/nutrition_preferences_changed/.test(c.def), c.def);
    },

    async "0294"({ db, h }) {
      const coach1 = await h.user("N1 Coach One");
      const coach2 = await h.user("N1 Coach Two");
      const stranger = await h.user("N1 Unrelated Coach");
      const ann = await h.user("N1 Ann");
      const bob = await h.user("N1 Bob");
      const org1 = await h.org(coach1);
      const org2 = await h.org(coach2);
      const org3 = await h.org(stranger);
      const gA = await h.group(org1, coach1, "team", "N1 group A");
      const gB = await h.group(org2, coach2, "team", "N1 group B");
      const gC = await h.group(org3, stranger, "team", "N1 group C");
      await h.member(gA, ann);
      await h.member(gB, ann); // one client, two coaches in two groups
      await h.member(gA, bob);

      // ---- the notification types ----
      const c = await h.one(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_type_check'`);
      h.check("the two new types are in the list", /nutrition_preferences_changed/.test(c.def) && /nutrition_prompt_answered/.test(c.def), c.def);
      const oldTypes = ["comment", "program_assigned", "macros_assigned", "partner_request", "partner_request_accepted", "milestone_celebration", "gym_visitor_lead", "trainer_dispatch_offer", "trainer_dispatch_question", "session_pattern_note", "credits_expired", "waitlist_slot_offered", "recurring_booking_conflict", "email_changed", "direct_message", "late_change", "booking_request", "request_decision", "goal_proposed", "goal_answered"];
      h.check("every type the database already had is still allowed (nothing dropped)", oldTypes.every((t) => c.def.includes(`'${t}'`)), c.def);
      await h.asSuper();
      const bad = await tryQ(db, `insert into public.notifications (profile_id, group_id, type, body, link_path) values ($1, $2, 'not_a_type', 'x', '/x')`, [ann, gA]);
      h.check("an unknown type is still refused", /violates check constraint/.test(bad.error ?? ""), JSON.stringify(bad));

      // ---- the client's first save: tastes stick, the rules that shape the numbers do not ----
      await h.as(ann);
      const first = await tryQ(db, `insert into public.client_nutrition_preferences (athlete_id, likes, diet_type, protein_g_per_lb, protein_floor_g_per_lb, carb_split, updated_by) values ($1, array['rice'], 'vegan', 1.5, 1.4, 'low', $2) returning diet_type, protein_g_per_lb, protein_floor_g_per_lb, carb_split, updated_by, likes`, [ann, coach1]);
      h.check("a client can save their own preferences", !first.error, JSON.stringify(first));
      h.check("on a first save the client's own diet type, protein and split are forced back to the defaults", first.rows?.[0]?.diet_type === "omnivore" && Number(first.rows?.[0]?.protein_g_per_lb) === 1 && Number(first.rows?.[0]?.protein_floor_g_per_lb) === 0.8 && first.rows?.[0]?.carb_split === "balanced", JSON.stringify(first));
      h.check("updated_by is the caller, never what was sent", first.rows?.[0]?.updated_by === ann, JSON.stringify(first));
      h.check("the tastes they sent were kept", (first.rows?.[0]?.likes ?? [])[0] === "rice");

      // ---- a coach sets the rules ----
      await h.as(coach1);
      const rules = await tryQ(db, `update public.client_nutrition_preferences set diet_type = 'vegetarian', protein_g_per_lb = 1.2, protein_floor_g_per_lb = 1.0, carb_split = 'high' where athlete_id = $1 returning diet_type, protein_g_per_lb, updated_by`, [ann]);
      h.check("a coach of the client can set the diet type, protein target and floor, and carb split", !rules.error && rules.rows?.[0]?.diet_type === "vegetarian" && Number(rules.rows?.[0]?.protein_g_per_lb) === 1.2, JSON.stringify(rules));
      h.check("updated_by is the coach after the coach's change", rules.rows?.[0]?.updated_by === coach1, JSON.stringify(rules));

      // ---- the client cannot move those rules afterwards ----
      await h.as(ann);
      const tryRules = await tryQ(db, `update public.client_nutrition_preferences set diet_type = 'omnivore', protein_g_per_lb = 0.6, protein_floor_g_per_lb = 0.4, carb_split = 'low', likes = array['rice','beans'] where athlete_id = $1 returning diet_type, protein_g_per_lb, protein_floor_g_per_lb, carb_split, likes`, [ann]);
      h.check("a client's change to the diet type, protein and split does not stick", tryRules.rows?.[0]?.diet_type === "vegetarian" && Number(tryRules.rows?.[0]?.protein_g_per_lb) === 1.2 && Number(tryRules.rows?.[0]?.protein_floor_g_per_lb) === 1.0 && tryRules.rows?.[0]?.carb_split === "high", JSON.stringify(tryRules));
      h.check("but the same save does keep the tastes they changed", (tryRules.rows?.[0]?.likes ?? []).length === 2, JSON.stringify(tryRules));
      const move = await tryQ(db, `update public.client_nutrition_preferences set athlete_id = $2 where athlete_id = $1`, [ann, bob]);
      h.check("a row cannot be handed to another person", move.error != null || (move.rows ?? []).length === 0, JSON.stringify(move));

      // ---- who can see and write it: any coach of ANY of the client's groups, nobody else ----
      await h.as(coach2);
      const c2read = await tryQ(db, `select diet_type from public.client_nutrition_preferences where athlete_id = $1`, [ann]);
      const c2write = await tryQ(db, `update public.client_nutrition_preferences set notes = 'from coach two' where athlete_id = $1 returning notes`, [ann]);
      h.check("the client's OTHER coach (a different group and organization) can read the same row", (c2read.rows ?? []).length === 1, JSON.stringify(c2read));
      h.check("and can write it", c2write.rows?.[0]?.notes === "from coach two", JSON.stringify(c2write));
      await h.as(stranger);
      const sRead = await tryQ(db, `select 1 from public.client_nutrition_preferences where athlete_id = $1`, [ann]);
      const sWrite = await tryQ(db, `update public.client_nutrition_preferences set notes = 'nope' where athlete_id = $1 returning 1`, [ann]);
      const sInsert = await tryQ(db, `insert into public.client_nutrition_preferences (athlete_id) values ($1)`, [bob]);
      h.check("a coach with no group in common cannot read the row", (sRead.rows ?? []).length === 0, JSON.stringify(sRead));
      h.check("cannot change it", (sWrite.rows ?? []).length === 0, JSON.stringify(sWrite));
      h.check("cannot create one for someone else's client", /row-level security/.test(sInsert.error ?? ""), JSON.stringify(sInsert));
      await h.as(bob);
      const bRead = await tryQ(db, `select 1 from public.client_nutrition_preferences where athlete_id = $1`, [ann]);
      const bInsert = await tryQ(db, `insert into public.client_nutrition_preferences (athlete_id) values ($1)`, [ann + ""]);
      h.check("another client cannot read someone else's preferences", (bRead.rows ?? []).length === 0, JSON.stringify(bRead));
      h.check("or write them", bInsert.error != null, JSON.stringify(bInsert));
      await h.as(null);
      const anon = await tryQ(db, `select 1 from public.client_nutrition_preferences`);
      h.check("signed out sees nothing", anon.error != null || (anon.rows ?? []).length === 0, JSON.stringify(anon));

      // ---- nobody deletes ----
      for (const [who, name] of [[ann, "the client"], [coach1, "their coach"]]) {
        await h.as(who);
        const del = await tryQ(db, `delete from public.client_nutrition_preferences where athlete_id = $1 returning 1`, [ann]);
        h.check(`${name} cannot delete the row`, (del.rows ?? []).length === 0, JSON.stringify(del));
      }
      await h.asSuper();
      h.check("the row is still there", (await h.one(`select count(*)::int as n from public.client_nutrition_preferences where athlete_id = $1`, [ann])).n === 1);

      // ---- the database's own checks ----
      await h.as(coach1);
      const tryVal = async (sql, params) => (await tryQ(db, sql, params)).error ?? "";
      h.check("a floor above the target is refused", /cnp_floor_not_above_target/.test(await tryVal(`update public.client_nutrition_preferences set protein_g_per_lb = 0.9, protein_floor_g_per_lb = 1.0 where athlete_id = $1`, [ann])));
      h.check("a target out of range is refused", /cnp_protein_target_ok/.test(await tryVal(`update public.client_nutrition_preferences set protein_g_per_lb = 1.6 where athlete_id = $1`, [ann])));
      h.check("a floor out of range is refused", /cnp_protein_floor_ok/.test(await tryVal(`update public.client_nutrition_preferences set protein_floor_g_per_lb = 0.3 where athlete_id = $1`, [ann])));
      h.check("an unknown diet type is refused", /cnp_diet_type_ok/.test(await tryVal(`update public.client_nutrition_preferences set diet_type = 'fruitarian' where athlete_id = $1`, [ann])));
      h.check("pescatarian is accepted", !(await tryVal(`update public.client_nutrition_preferences set diet_type = 'pescatarian' where athlete_id = $1`, [ann])));
      h.check("meals per day is 2 to 6", /cnp_meals_ok/.test(await tryVal(`update public.client_nutrition_preferences set meals_per_day = 7 where athlete_id = $1`, [ann])) && /cnp_meals_ok/.test(await tryVal(`update public.client_nutrition_preferences set meals_per_day = 1 where athlete_id = $1`, [ann])));
      h.check("a list of more than 40 foods is refused", /cnp_likes_ok/.test(await tryVal(`update public.client_nutrition_preferences set likes = (select array_agg('f' || g) from generate_series(1, 41) g) where athlete_id = $1`, [ann])));
      h.check("an item over 60 characters is refused", /cnp_dislikes_ok/.test(await tryVal(`update public.client_nutrition_preferences set dislikes = array[repeat('x', 61)] where athlete_id = $1`, [ann])));
      h.check("a blank item is refused", /cnp_dislikes_ok/.test(await tryVal(`update public.client_nutrition_preferences set dislikes = array['  '] where athlete_id = $1`, [ann])));
      h.check("an allergy must be a controlled name or 'other: ...'", /cnp_allergies_ok/.test(await tryVal(`update public.client_nutrition_preferences set allergies = array['sunshine'] where athlete_id = $1`, [ann])));
      h.check("a controlled allergy and an 'other:' allergy are accepted", !(await tryVal(`update public.client_nutrition_preferences set allergies = array['peanut', 'other: kiwi'] where athlete_id = $1`, [ann])));
      h.check("notes over 500 characters are refused", /cnp_notes_ok/.test(await tryVal(`update public.client_nutrition_preferences set notes = repeat('n', 501) where athlete_id = $1`, [ann])));

      // ---- the notice to the coaches: fixed wording, once, not to the person who made the change ----
      await h.asSuper();
      await db.query(`delete from public.notifications where type = 'nutrition_preferences_changed'`);
      await db.query(`update public.client_nutrition_preferences set allergies = '{}', dislikes = '{}' where athlete_id = $1`, [ann]);
      await db.query(`delete from public.notifications where type = 'nutrition_preferences_changed'`);
      await h.as(ann);
      await db.query(`update public.client_nutrition_preferences set allergies = array['peanut', 'other: kiwi'] where athlete_id = $1`, [ann]);
      await h.asSuper();
      const n1 = await h.rows(`select profile_id, group_id, body, link_path from public.notifications where type = 'nutrition_preferences_changed' order by profile_id`);
      h.check("both of the client's coaches are told, each for their own group", n1.length === 2 && n1.some((r) => r.profile_id === coach1 && r.group_id === gA) && n1.some((r) => r.profile_id === coach2 && r.group_id === gB), JSON.stringify(n1));
      h.check("the wording is fixed and carries none of what was typed", n1.every((r) => r.body === "N1 Ann changed their food preferences" && !/peanut|kiwi/i.test(r.body)), JSON.stringify(n1));
      h.check("the link opens that client in Nutrition", n1.every((r) => /\/nutrition\?athleteId=/.test(r.link_path)), JSON.stringify(n1));
      h.check("the client is not told about their own change", !n1.some((r) => r.profile_id === ann));
      h.check("an unrelated coach is not told", !n1.some((r) => r.profile_id === stranger));
      await h.as(ann);
      await db.query(`update public.client_nutrition_preferences set dislikes = array['liver'] where athlete_id = $1`, [ann]);
      await h.asSuper();
      h.check("a second change while the first is still unread does not stack a second notice", (await h.one(`select count(*)::int as n from public.notifications where type = 'nutrition_preferences_changed' and profile_id = $1`, [coach1])).n === 1);
      await db.query(`delete from public.notifications where type = 'nutrition_preferences_changed'`);
      await h.as(ann);
      await db.query(`update public.client_nutrition_preferences set likes = array['rice', 'beans', 'fish'] where athlete_id = $1`, [ann]);
      await h.asSuper();
      h.check("a change to only likes sends no notice", (await h.one(`select count(*)::int as n from public.notifications where type = 'nutrition_preferences_changed'`)).n === 0);
      await h.as(coach1);
      await db.query(`update public.client_nutrition_preferences set allergies = array['peanut', 'other: kiwi', 'egg'] where athlete_id = $1`, [ann]);
      await h.asSuper();
      const n2 = await h.rows(`select profile_id from public.notifications where type = 'nutrition_preferences_changed'`);
      h.check("when a coach changes the allergies, the other coach is told and the coach who made the change is not", n2.length === 1 && n2[0].profile_id === coach2, JSON.stringify(n2));

      // ---- the server (service role) is not held back by the client guard ----
      await h.asService();
      const svc = await tryQ(db, `update public.client_nutrition_preferences set diet_type = 'vegan' where athlete_id = $1 returning diet_type`, [ann]);
      h.check("the server can change the rules (the guard only restrains a signed-in client)", svc.rows?.[0]?.diet_type === "vegan", JSON.stringify(svc));
      await h.asSuper();

      // ---- the answer to "are you happy with your meal plan?" ----
      await h.as(ann);
      const f1 = await tryQ(db, `insert into public.client_nutrition_feedback (athlete_id, group_id, target_effective_from, happy, change_text, requests_text, boring) values ($1, $2, '2026-10-14', false, 'less rice', 'more fish', true) returning id, status`, [ann, gA]);
      h.check("a client can answer for themself, in a group they are a client in", !f1.error && f1.rows?.[0]?.status === "new", JSON.stringify(f1));
      const dup = await tryQ(db, `insert into public.client_nutrition_feedback (athlete_id, group_id, target_effective_from, happy) values ($1, $2, '2026-10-14', true)`, [ann, gA]);
      h.check("only one answer per target change", /client_nutrition_feedback_one_per_change|duplicate key/.test(dup.error ?? ""), JSON.stringify(dup));
      const otherGroup = await tryQ(db, `insert into public.client_nutrition_feedback (athlete_id, group_id, target_effective_from, happy) values ($1, $2, '2026-10-15', true)`, [ann, gC]);
      h.check("cannot answer into a group they are not in", /row-level security/.test(otherGroup.error ?? ""), JSON.stringify(otherGroup));
      const asOther = await tryQ(db, `insert into public.client_nutrition_feedback (athlete_id, group_id, target_effective_from, happy) values ($1, $2, '2026-10-16', true)`, [bob, gA]);
      h.check("cannot answer as someone else", /row-level security/.test(asOther.error ?? ""), JSON.stringify(asOther));
      const preHandled = await tryQ(db, `insert into public.client_nutrition_feedback (athlete_id, group_id, target_effective_from, happy, status) values ($1, $2, '2026-10-17', true, 'handled')`, [ann, gA]);
      h.check("cannot mark their own answer handled", /row-level security/.test(preHandled.error ?? ""), JSON.stringify(preHandled));
      const clientUpdate = await tryQ(db, `update public.client_nutrition_feedback set status = 'handled', change_text = 'edited' where athlete_id = $1 returning 1`, [ann]);
      h.check("a client cannot change an answer once given", (clientUpdate.rows ?? []).length === 0, JSON.stringify(clientUpdate));
      const clientRead = await tryQ(db, `select count(*)::int as n from public.client_nutrition_feedback`);
      h.check("a client reads only their own answers", clientRead.rows?.[0]?.n === 1, JSON.stringify(clientRead));
      await h.as(bob);
      h.check("another client sees none of it", (await tryQ(db, `select 1 from public.client_nutrition_feedback`)).rows?.length === 0);
      await h.as(stranger);
      h.check("a coach of another group sees none of it", (await tryQ(db, `select 1 from public.client_nutrition_feedback`)).rows?.length === 0);
      await h.as(coach1);
      h.check("a coach of the group reads it", (await tryQ(db, `select 1 from public.client_nutrition_feedback`)).rows?.length === 1);
      const handled = await tryQ(db, `update public.client_nutrition_feedback set status = 'handled', change_text = 'rewritten', happy = true, handled_by = $2, handled_at = '2000-01-01' where athlete_id = $1 returning status, change_text, happy, handled_by, handled_at`, [ann, bob]);
      h.check("a coach can mark an answer handled", handled.rows?.[0]?.status === "handled", JSON.stringify(handled));
      h.check("who handled it and when come from the caller, never from what was sent", handled.rows?.[0]?.handled_by === coach1 && new Date(handled.rows?.[0]?.handled_at).getFullYear() >= 2026, JSON.stringify(handled));
      h.check("the answer itself cannot be rewritten by a coach", handled.rows?.[0]?.change_text === "less rice" && handled.rows?.[0]?.happy === false, JSON.stringify(handled));
      await h.asSuper();
      const fn = await h.rows(`select profile_id, body from public.notifications where type = 'nutrition_prompt_answered'`);
      h.check("the group's coach is told, with fixed wording and none of the typed text", fn.length === 1 && fn[0].profile_id === coach1 && fn[0].body === "N1 Ann answered a nutrition prompt" && !/rice|fish/.test(fn[0].body), JSON.stringify(fn));
      await db.query(`delete from public.client_nutrition_feedback`); // clean up the rehearsal row (as the superuser)
      await db.query(`insert into public.client_nutrition_feedback (athlete_id, group_id, target_effective_from, happy) values ($1, $2, '2026-10-20', true)`, [ann, gA]);
      await h.as(coach1);
      const coachDel = await tryQ(db, `delete from public.client_nutrition_feedback returning 1`);
      h.check("a coach cannot delete an answer", (coachDel.rows ?? []).length === 0, JSON.stringify(coachDel));
      await h.asSuper();

      // ---- no new function a signed-in person can run directly ----
      const open = await h.rows(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('guard_client_nutrition_preferences', 'notify_on_nutrition_preferences', 'guard_client_nutrition_feedback', 'notify_on_nutrition_feedback') and p.prorettype <> 'trigger'::regtype`);
      h.check("all four new security-definer functions are trigger functions (nobody can call them directly)", open.length === 0, JSON.stringify(open));
    },
  },
};
