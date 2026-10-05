// 0267: the audit trail. Append-only and readable only by the platform admin; one row per real change to the watched columns with who did it and
// in what role; blocked client writes leave a record too. Run as real roles.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0267 audit trail",
  migrations: ["0267"],
  phases: {
    async "0267"({ db, h }) {
      const admin = await h.platformAdmin("Audit Admin");
      const coach = await h.user("Audit Coach");
      const ann = await h.user("Audit Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Audit group");
      await h.member(group, ann);
      await h.asSuper();
      await db.query(`delete from public.audit_log`).catch(() => {});
      const rowsFor = async (table, key) => { await h.asSuper(); return (await h.rows(`select * from public.audit_log where table_name = $1 and ($2::text is null or row_key = $2) order by id`, [table, key])); };
      const total = async () => { await h.asSuper(); return (await h.one(`select count(*)::int as n from public.audit_log`)).n; };

      // ---- the platform-admin flag change by the service role is recorded with the role; platform admin created above should already show
      let rows = await rowsFor("profiles", admin);
      h.check("a profile made platform admin through the service role is recorded: who (role), what, old and new",
        rows.some((r) => r.action === "update" && r.actor_role === "service_role" && r.changed.is_platform_admin?.old === false && r.changed.is_platform_admin?.new === true), JSON.stringify(rows.map((r) => [r.action, r.actor_role, r.changed])));

      // ---- no-op saves write nothing; a rename is not a watched column
      let before = await total();
      await h.as(ann);
      await tryQ(db, `update public.profiles set full_name = 'Ann Audit' where id = $1`, [ann]);
      h.check("an ordinary save (a rename) writes no audit row", (await total()) === before);

      // ---- SQL editor change is labelled
      await h.asSuper();
      await db.query(`update public.profiles set intake_required = true where id = $1`, [ann]);
      rows = await rowsFor("profiles", ann);
      h.check("a change from the SQL editor (no API role) is labelled sql_editor", rows.some((r) => r.action === "update" && r.actor_role === "sql_editor" && r.changed.intake_required?.new === true), JSON.stringify(rows));

      // ---- blocked attempts
      before = await total();
      await h.as(ann);
      await tryQ(db, `update public.profiles set intake_required = false, claimed_at = now() where id = $1`, [ann]);
      rows = (await rowsFor("profiles", ann)).filter((r) => r.action === "blocked_write");
      h.check("a client's blocked attempt to clear their waiver gate and claim themselves is recorded with their id and what they tried",
        rows.length === 1 && rows[0].actor_uid === ann && rows[0].actor_role === "authenticated" && rows[0].changed.intake_required?.new === false && !!rows[0].changed.claimed_at, JSON.stringify(rows));
      h.check("...and only the blocked row was written (the kept values did not change, so no update row)", (await total()) === before + 1);
      await h.as(ann);
      await tryQ(db, `update public.profiles set is_platform_admin = true where id = $1`, [ann]);
      rows = (await rowsFor("profiles", ann)).filter((r) => r.action === "blocked_write" && r.changed.is_platform_admin);
      h.check("a blocked attempt to become platform admin is recorded", rows.length === 1 && rows[0].changed.is_platform_admin.new === true, JSON.stringify(rows));
      await h.asSuper();
      const stranger = (await db.query(`select gen_random_uuid() as id`)).rows[0].id;
      await db.query(`insert into auth.users (id, email) values ($1, 'audit.signup@example.com')`, [stranger]);
      await h.as(stranger);
      await tryQ(db, `insert into public.profiles (id, full_name, is_platform_admin) values ($1, 'Sneaky', true)`, [stranger]);
      rows = await rowsFor("profiles", stranger);
      h.check("a self-created profile attempting admin is recorded as blocked and the new profile as an insert",
        rows.some((r) => r.action === "blocked_write" && r.changed.is_platform_admin?.new === true) && rows.some((r) => r.action === "insert"), JSON.stringify(rows.map((r) => [r.action, r.changed])));

      // blocked writes on the other guarded tables
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id`, [group, coach])).rows[0].id;
      const workout = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'D', 1) returning id`, [prog, group])).rows[0].id;
      const sess = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, status) values ($1, $2, $3, 'completed') returning id`, [workout, group, ann])).rows[0].id;
      const log = (await db.query(`insert into public.workout_logs (session_id, athlete_id, group_id, workout_id, total_volume) values ($1, $2, $3, $4, 1000) returning id`, [sess, ann, group, workout])).rows[0].id;
      const post = (await db.query(`insert into public.posts (group_id, author_id, post_type, body) values ($1, $2, 'user_post', 'hi') returning id`, [group, ann])).rows[0].id;
      await h.as(ann);
      await tryQ(db, `update public.athlete_sessions set is_historical = true where id = $1`, [sess]);
      await tryQ(db, `update public.workout_logs set total_volume = 999999 where id = $1`, [log]);
      await tryQ(db, `update public.posts set channel = 'announcements' where id = $1`, [post]);
      h.check("blocked attempts on a session flag, a workout total and an Announcements post are each recorded",
        (await rowsFor("athlete_sessions", sess)).some((r) => r.action === "blocked_write" && r.changed.is_historical) &&
        (await rowsFor("workout_logs", log)).some((r) => r.action === "blocked_write" && r.changed.total_volume?.new === 999999) &&
        (await rowsFor("posts", post)).some((r) => r.action === "blocked_write" && r.changed.channel?.new === "announcements"));
      await h.asSuper();
      h.check("...and the Announcements move is put back (recorded instead of raising)", (await h.one(`select channel from public.posts where id = $1`, [post])).channel === "general");

      // ---- session credits
      await h.as(coach);
      await db.query(`select public.assign_session_credits($1, $2, 5, 'start')`, [ann, group]);
      rows = await rowsFor("session_credits", `${ann}:${group}`);
      h.check("a balance change is recorded with the actor", rows.some((r) => r.actor_uid === coach && r.changed.balance?.new === 5), JSON.stringify(rows));
      before = await total();
      await h.as(coach);
      await tryQ(db, `update public.session_credits set updated_at = now() where athlete_id = $1`, [ann]);
      h.check("a save that changes no watched column writes nothing", (await total()) === before);
      await tryQ(db, `update public.session_credits set payment_hold = true where athlete_id = $1`, [ann]);
      h.check("a payment hold is recorded", (await rowsFor("session_credits", `${ann}:${group}`)).some((r) => r.changed.payment_hold?.new === true));

      // ---- bookings: credit state
      await h.as(coach);
      const b = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, new Date(Date.now() + 3 * 86400000).toISOString(), new Date(Date.now() + 3 * 86400000 + 3600000).toISOString()])).id;
      h.check("booking a session writes no bookings audit row (inserts are not watched)", (await rowsFor("bookings", b)).length === 0);
      await h.as(coach);
      await db.query(`select public.waive_booking($1, 'holiday')`, [b]);
      rows = await rowsFor("bookings", b);
      h.check("waiving a booking records the credit_state change", rows.length === 1 && rows[0].changed.credit_state?.old === "unsettled" && rows[0].changed.credit_state?.new === "waived", JSON.stringify(rows));
      await h.as(coach);
      await tryQ(db, `update public.bookings set session_type = 'video' where id = $1`, [b]);
      h.check("an unrelated booking edit writes nothing", (await rowsFor("bookings", b)).length === 1);

      // ---- organization_billing
      await h.asService();
      await db.query(`insert into public.organization_billing (organization_id, billing_exempt) values ($1, false) on conflict (organization_id) do nothing`, [org]);
      await db.query(`update public.organization_billing set billing_exempt = true, ai_allowance_scale = 0.5 where organization_id = $1`, [org]);
      rows = await rowsFor("organization_billing", org);
      h.check("billing changes are recorded: the insert and the exempt/scale update with old and new", rows.some((r) => r.action === "insert") && rows.some((r) => r.action === "update" && r.changed.billing_exempt?.new === true && r.changed.ai_allowance_scale?.new === 0.5), JSON.stringify(rows.map((r) => [r.action, r.changed])));

      // ---- who can read, who can write
      await h.as(admin);
      h.check("the platform admin reads the audit log", (await h.rows(`select 1 from public.audit_log`)).length > 10);
      for (const [who, label] of [[ann, "a client"], [coach, "a coach"]]) {
        await h.as(who);
        h.check(`${label} reads nothing`, (await h.rows(`select 1 from public.audit_log`)).length === 0);
        h.check(`${label} cannot insert, update or delete audit rows`,
          !!(await tryQ(db, `insert into public.audit_log (table_name, action, actor_role) values ('x', 'insert', 'x')`)).error &&
          !!(await tryQ(db, `update public.audit_log set table_name = 'x'`)).error &&
          !!(await tryQ(db, `delete from public.audit_log`)).error);
      }
      await h.as(admin);
      h.check("not even the platform admin can insert, update or delete (read-only through the API)",
        !!(await tryQ(db, `insert into public.audit_log (table_name, action, actor_role) values ('x', 'insert', 'x')`)).error && !!(await tryQ(db, `delete from public.audit_log`)).error);
      await h.asService();
      const upd = await tryQ(db, `update public.audit_log set table_name = 'tampered'`);
      const del = await tryQ(db, `delete from public.audit_log`);
      const trunc = await tryQ(db, `truncate public.audit_log`);
      h.check("append-only holds even against the service role: update, delete and truncate are refused", /append-only/.test(upd.error ?? "") && /append-only/.test(del.error ?? "") && /append-only/.test(trunc.error ?? ""), JSON.stringify([upd, del, trunc]));
      h.check("the writer functions cannot be called from the API", !!(await tryQ(db, `select public.audit_record('x', 'k', 'insert', '{}')`)).error);
      await h.as(coach);
      h.check("...by a signed-in user either", !!(await tryQ(db, `select public.audit_record('x', 'k', 'insert', '{}')`)).error);
    },
  },
};
