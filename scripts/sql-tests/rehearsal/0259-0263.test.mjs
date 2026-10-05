// 0259 ongoing series columns and constraints; 0260 payment hold / re-up bookkeeping; 0261 public booking page tables (no anon access);
// 0262 cron runs; 0263 small-group sessions on the real schema (the stand-in version is group-sessions.test.mjs).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

export default {
  name: "0259 ongoing series, 0260 re-up fields, 0261 public booking tables, 0262 cron runs, 0263 group sessions",
  migrations: ["0259", "0260", "0261", "0262", "0263"],
  phases: {
    async "0259"({ db, h, state }) {
      const coach = await h.user("Series Coach");
      const ann = await h.user("Series Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Series group");
      await h.member(group, ann);
      Object.assign(state, { coach, ann, org, group });
      await h.as(coach);
      const s = (await h.rows(`select * from public.create_recurring_booking_series($1, $2, $3, $4, 60, 3)`, [coach, ann, group, inDays(7)]))[0];
      h.check("0259: the existing fixed-count series function still works on the new columns", s.booked_count === 3 && s.failed_count === 0, JSON.stringify(s));
      await h.asSuper();
      const row = await h.one(`select mode, window_weeks, paused_at, skipped_starts from public.recurring_booking_series where id = $1`, [s.series_id]);
      h.check("0259: an existing-style series reads as mode 'fixed', 12-week window, not paused, nothing skipped", row.mode === "fixed" && row.window_weeks === 12 && row.paused_at === null && row.skipped_starts.length === 0, JSON.stringify(row));

      await h.asService();
      const ins = (extra, vals = "") => tryQ(db, `insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes${extra.cols ?? ""}) values ($1, $2, $3, 2, '06:00', 60${extra.vals ?? ""}) returning id`, [coach, ann, group]);
      h.check("0259: an ongoing series with no total is allowed", !!(await ins({ cols: ", mode", vals: ", 'ongoing'" })).rows);
      h.check("0259: a fixed series with no total is refused", !!(await ins({})).error);
      h.check("0259: a fixed series above 52 weeks is refused", !!(await ins({ cols: ", occurrences_total", vals: ", 53" })).error);
      h.check("0259: a fixed series of 52 is allowed", !!(await ins({ cols: ", occurrences_total", vals: ", 52" })).rows);
      h.check("0259: a mode outside fixed/ongoing is refused", !!(await ins({ cols: ", mode, occurrences_total", vals: ", 'forever', 4" })).error);
      h.check("0259: a window of 0 or 53 weeks is refused", !!(await ins({ cols: ", mode, window_weeks", vals: ", 'ongoing', 0" })).error && !!(await ins({ cols: ", mode, window_weeks", vals: ", 'ongoing', 53" })).error);
      h.check("0259: paused and ended are valid statuses", !!(await ins({ cols: ", mode, status", vals: ", 'ongoing', 'paused'" })).rows && !!(await ins({ cols: ", mode, status", vals: ", 'ongoing', 'ended'" })).rows);
      h.check("0259: an unknown status is refused", !!(await ins({ cols: ", mode, status", vals: ", 'ongoing', 'bogus'" })).error);
      await h.as(coach);
      h.check("0259: a coach cannot write series rows directly (the server does, after checking)", !!(await tryQ(db, `insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes, occurrences_total) values ($1, $2, $3, 2, '06:00', 60, 4)`, [coach, ann, group])).error);
    },

    async "0260"({ db, h, state }) {
      const { coach, ann, group } = state;
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 2) on conflict (athlete_id, group_id) do update set balance = 2`, [ann, group]);
      const row = await h.one(`select payment_hold, last_reup_nudge_at, low_balance_alert_level from public.session_credits where athlete_id = $1 and group_id = $2`, [ann, group]);
      h.check("0260: existing credit rows start with no hold, no reminder and no alert level", row.payment_hold === false && row.last_reup_nudge_at === null && row.low_balance_alert_level === null);
      for (const v of [3, 1, 0, null]) {
        const r = await tryQ(db, `update public.session_credits set low_balance_alert_level = $1 where athlete_id = $2 and group_id = $3 returning 1`, [v, ann, group]);
        h.check(`0260: alert level ${v} is accepted`, !!r.rows);
      }
      h.check("0260: any other alert level is refused", !!(await tryQ(db, `update public.session_credits set low_balance_alert_level = 2 where athlete_id = $1 and group_id = $2`, [ann, group])).error);
      await db.query(`insert into public.coach_booking_policies (coach_id) values ($1) on conflict do nothing`, [coach]);
      h.check("0260: reminders are on by default for a coach", (await h.one(`select reup_nudges_enabled as v from public.coach_booking_policies where coach_id = $1`, [coach])).v === true);
    },

    async "0261"({ db, h, state }) {
      const { coach, ann, group } = state;
      const other = await h.user("Page Other Coach");
      await h.org(other);
      await h.asSuper();
      const page = await tryQ(db, `insert into public.coach_booking_pages (coach_id, slug) values ($1, 'ron-arnold') returning enabled, show_prices`, [coach]);
      h.check("0261: a booking page starts off, with prices hidden", page.rows?.[0]?.enabled === false && page.rows[0].show_prices === false, page.error);
      for (const bad of ["a", "-bad", "bad-", "Has Space", "UPPER", "x".repeat(41), "bad_underscore"]) {
        h.check(`0261: slug "${bad.length > 12 ? bad.slice(0, 12) + "..." : bad}" is refused`, !!(await tryQ(db, `insert into public.coach_booking_pages (coach_id, slug) values ($1, $2)`, [other, bad])).error);
      }
      h.check("0261: two coaches cannot share a slug", !!(await tryQ(db, `insert into public.coach_booking_pages (coach_id, slug) values ($1, 'ron-arnold')`, [other])).error);
      h.check("0261: a good slug is accepted", !!(await tryQ(db, `insert into public.coach_booking_pages (coach_id, slug) values ($1, 'other-coach-42') returning 1`, [other])).rows);

      await h.as(coach);
      h.check("0261: a coach reads and edits their own page", (await h.rows(`select 1 from public.coach_booking_pages`)).length === 1 && !!(await tryQ(db, `update public.coach_booking_pages set enabled = true where coach_id = $1 returning 1`, [coach])).rows);
      h.check("0261: ...and cannot create a page for another coach", !!(await tryQ(db, `insert into public.coach_booking_pages (coach_id, slug) values ($1, 'stolen-page')`, [other])).error);

      // guest contact details: only the owning coach, never anon, never the client
      await h.asSuper();
      const bk = (await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, booked_via) values ($1, $2, $3, $4, $5, 'public_page') returning id`, [coach, ann, group, inDays(9), new Date(Date.now() + 9 * 86400000 + 3600000).toISOString()])).rows[0].id;
      await db.query(`insert into public.booking_manage_links (booking_id, coach_id, athlete_id, token_hash, guest_name, guest_email) values ($1, $2, $3, 'hash-1', 'Guest', 'guest@example.com')`, [bk, coach, ann]);
      h.check("0261: a token hash is unique (one manage link per hash)", !!(await tryQ(db, `insert into public.booking_manage_links (booking_id, coach_id, athlete_id, token_hash, guest_name, guest_email) values ($1, $2, $3, 'hash-1', 'G2', 'g2@example.com')`, [bk, coach, ann])).error);
      await h.as(coach);
      h.check("0261: the coach reads the details of people who booked with them", (await h.rows(`select guest_email from public.booking_manage_links`)).length === 1);
      await h.as(other);
      h.check("0261: another coach cannot", (await h.rows(`select 1 from public.booking_manage_links`)).length === 0);
      await h.as(ann);
      h.check("0261: the booked person (a placeholder client) cannot read the link row either", (await h.rows(`select 1 from public.booking_manage_links`)).length === 0);
      await h.as(null);
      for (const t of ["coach_booking_pages", "booking_manage_links"]) {
        const q = await tryQ(db, `select count(*)::int as n from public.${t}`);
        h.check(`0261: a signed-out visitor reads nothing from ${t}`, q.error ? true : q.rows[0].n === 0);
      }
      h.check("0261: a signed-out visitor cannot write a manage link", !!(await tryQ(db, `insert into public.booking_manage_links (booking_id, coach_id, athlete_id, token_hash, guest_name, guest_email) values ($1, $2, $3, 'x', 'x', 'x')`, [bk, coach, ann])).error);
      await h.as(coach);
      h.check("0261: a coach cannot write a manage link directly (the server does)", !!(await tryQ(db, `insert into public.booking_manage_links (booking_id, coach_id, athlete_id, token_hash, guest_name, guest_email) values ($1, $2, $3, 'y', 'y', 'y')`, [bk, coach, ann])).error);

      await h.asSuper();
      const st = await tryQ(db, `insert into public.session_types (coach_id, name) values ($1, 'Intro session') returning public_visible, duration_minutes, location_kind, sort_order`, [coach]);
      h.check("0261: a session type is private by default, 60 minutes, in person", st.rows?.[0]?.public_visible === false && st.rows[0].duration_minutes === 60 && st.rows[0].location_kind === "in_person", st.error);
      h.check("0261: a session length outside 5-480 minutes is refused", !!(await tryQ(db, `insert into public.session_types (coach_id, name, duration_minutes) values ($1, 'x', 4)`, [coach])).error && !!(await tryQ(db, `insert into public.session_types (coach_id, name, duration_minutes) values ($1, 'x', 481)`, [coach])).error);
      h.check("0261: a location kind outside in_person/online/either is refused", !!(await tryQ(db, `insert into public.session_types (coach_id, name, location_kind) values ($1, 'x', 'moon')`, [coach])).error);
      h.check("0261: a negative display price is refused", !!(await tryQ(db, `insert into public.session_types (coach_id, name, display_price_cents) values ($1, 'x', -1)`, [coach])).error);
      h.check("0261: bookings can say they came from the public page, and only from the known sources", !!(await tryQ(db, `update public.bookings set booked_via = 'public_page' where id = $1 returning 1`, [bk])).rows && !!(await tryQ(db, `update public.bookings set booked_via = 'carrier pigeon' where id = $1`, [bk])).error);
    },

    async "0262"({ db, h }) {
      const admin = await h.platformAdmin("Cron Admin");
      const user = await h.user("Cron User");
      await h.asService();
      await db.query(`insert into public.cron_runs (job, last_status, consecutive_failures) values ('series-top-up', 'ok', 0)`);
      h.check("0262: the server records a job run", true);
      h.check("0262: a status outside ok/error is refused", !!(await tryQ(db, `insert into public.cron_runs (job, last_status) values ('x', 'maybe')`)).error);
      h.check("0262: one row per job", !!(await tryQ(db, `insert into public.cron_runs (job, last_status) values ('series-top-up', 'ok')`)).error);
      await h.as(user);
      h.check("0262: an ordinary user cannot read job runs", (await h.rows(`select 1 from public.cron_runs`)).length === 0);
      h.check("0262: an ordinary user cannot write them", !!(await tryQ(db, `insert into public.cron_runs (job, last_status) values ('y', 'ok')`)).error);
      await h.as(admin);
      h.check("0262: the platform admin reads them", (await h.rows(`select 1 from public.cron_runs`)).length === 1);
    },

    async "0263"({ db, h, state }) {
      const { coach, ann, group } = state;
      const bo = await h.user("Class Bo");
      const cy = await h.user("Class Cy");
      await h.member(group, bo);
      await h.member(group, cy);
      await h.asSuper();
      for (const [a, n] of [[ann, 3], [bo, 3], [cy, 3]]) await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, $3) on conflict (athlete_id, group_id) do update set balance = $3`, [a, group, n]);
      const bal = async (a) => { await h.asSuper(); return (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [a, group])).balance; };
      const start = inDays(20);
      const end = new Date(Date.now() + 20 * 86400000 + 3600000).toISOString();

      await h.as(coach);
      const cls = (await h.one(`select public.create_group_session($1, 'Boot camp', $2, $3, 2) as id`, [group, start, end])).id;
      h.check("0263: the coach creates a class on the real schema", !!cls);
      await h.expectError("0263: the class's time is held in the coach's calendar: a 1-on-1 booking at the same time is refused", () => db.query(`select public.book_session($1, $2, $3, $4, $5)`, [coach, ann, group, start, end]), /already|taken|unique|duplicate|booked/i);
      await h.as(ann);
      h.check("0263: a client joins", (await h.one(`select public.join_group_session($1, $2) as r`, [cls, ann])).r === "joined" && (await bal(ann)) === 2);
      await h.as(bo);
      await h.one(`select public.join_group_session($1, $2) as r`, [cls, bo]);
      await h.as(cy);
      h.check("0263: a third client goes on the waiting list, uncharged", (await h.one(`select public.join_group_session($1, $2) as r`, [cls, cy])).r === "waitlisted" && (await bal(cy)) === 3);
      await h.as(ann);
      const moved = (await h.one(`select public.leave_group_session($1, $2) as p`, [cls, ann])).p;
      h.check("0263: when someone leaves in time, they are refunded and the first in line moves in and is charged", (await bal(ann)) === 3 && moved[0] === cy && (await bal(cy)) === 2, JSON.stringify(moved));
      await h.as(coach);
      const told = (await h.one(`select public.cancel_group_session($1) as a`, [cls])).a;
      h.check("0263: cancelling the class refunds everyone who paid and frees the coach's time", (await bal(bo)) === 3 && (await bal(cy)) === 3 && told.length >= 2);
      await h.as(coach);
      h.check("0263: the freed time can be booked again", !!(await tryQ(db, `select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, start, end])).rows);
      await h.as(ann);
      h.check("0263: a client cannot create a class", !!(await tryQ(db, `select public.create_group_session($1, 'Nope', $2, $3, 4)`, [group, inDays(30), new Date(Date.now() + 30 * 86400000 + 3600000).toISOString()])).error);
    },
  },
};
