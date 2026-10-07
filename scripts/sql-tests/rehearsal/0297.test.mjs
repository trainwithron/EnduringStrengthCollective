// 0297: pause, freeze or cancel a client's weekly schedule. A client asks for their own schedule only, the change applies on the chosen date, the private note is for
// coaches only, the server-only functions are closed to signed-in people, and a freeze adds its length to the expiry hold without changing any existing function.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const ADD = (d, n) => `(${d}::date + ${n})`;

async function scene(h, db, label) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const bob = await h.user(`${label} Bob`);
  const outsider = await h.user(`${label} Outside Coach`);
  const admin = await h.user(`${label} Org Admin`);
  const org = await h.org(coach);
  await h.orgMember(org, admin, "admin");
  const group = await h.group(org, coach, "team", `${label} group`);
  await h.member(group, ann);
  await h.member(group, bob);
  const org2 = await h.org(outsider);
  await h.group(org2, outsider, "team", `${label} other group`);
  await h.asSuper();
  const mk = async (athlete) => (await db.query(
    `insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes, occurrences_total, mode, timezone, anchor_date)
     values ($1, $2, $3, 2, '09:00', 60, null, 'ongoing', 'America/New_York', current_date) returning id`, [coach, athlete, group])).rows[0].id;
  const annSeries = await mk(ann);
  const bobSeries = await mk(bob);
  return { coach, ann, bob, outsider, admin, org, group, annSeries, bobSeries };
}

export default {
  name: "0297 schedule requests",
  migrations: ["0297"],
  phases: {
    async "0296"({ db, h }) {
      const t = await h.one(`select to_regclass('public.schedule_requests') as t`);
      const c = await h.one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'recurring_booking_series' and column_name = 'frozen_from'`);
      h.check("baseline: there are no schedule requests and no freeze dates yet", t.t === null && c.n === 0, JSON.stringify({ t, c }));
      const s = await scene(h, db, "S1");
      const types = (await h.rows(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notifications_type_check'`))[0].d;
      globalThis.__s297 = { ...s, typesBefore: [...types.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort(), seriesBefore: (await h.one(`select count(*)::int as n from public.recurring_booking_series`)).n };
    },

    async "0297"({ db, h }) {
      const s = globalThis.__s297;
      const { coach, ann, bob, outsider, admin, group, annSeries, bobSeries } = s;
      const today = (await h.one(`select public.schedule_local_today('America/New_York', $1) as d`, [coach])).d;
      const iso = (d) => new Date(d).toISOString().slice(0, 10);
      const plus = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

      // ---- nothing existing was lost ----
      const typesAfter = [...(await h.one(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notifications_type_check'`)).d.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
      h.check("the notification types are the old list plus schedule_request, schedule_applied and schedule_resumed (nothing dropped)",
        s.typesBefore.every((t) => typesAfter.includes(t)) && typesAfter.length === s.typesBefore.length + 3 && ["schedule_request", "schedule_applied", "schedule_resumed"].every((t) => typesAfter.includes(t)),
        JSON.stringify({ before: s.typesBefore.length, after: typesAfter.length }));
      h.check("existing schedules are untouched (same count, no freeze dates)", (await h.one(`select count(*)::int as n from public.recurring_booking_series`)).n === s.seriesBefore &&
        (await h.one(`select count(*)::int as n from public.recurring_booking_series where frozen_from is not null or frozen_until is not null`)).n === 0);

      // ---- the client asks ----
      await h.as(ann);
      const ok = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, $3) as id`, [annSeries, plus(3), "my husband is ill"]);
      h.check("a client asks to pause their own schedule", !ok.error && !!ok.rows?.[0]?.id, JSON.stringify(ok));
      const reqId = ok.rows?.[0]?.id;
      const mine = await tryQ(db, `select kind, status, effective_on::text, resume_on from public.schedule_requests where id = $1`, [reqId]);
      h.check("the request is pending with the date they chose", mine.rows?.[0]?.status === "pending" && mine.rows[0].kind === "pause" && mine.rows[0].effective_on === plus(3), JSON.stringify(mine));
      const ownNote = await tryQ(db, `select count(*)::int as n from public.schedule_request_notes`);
      h.check("the client cannot read the private note back", ownNote.rows?.[0]?.n === 0, JSON.stringify(ownNote));
      await h.as(coach);
      const coachNote = await tryQ(db, `select note from public.schedule_request_notes where request_id = $1`, [reqId]);
      h.check("the coach reads the note", coachNote.rows?.[0]?.note === "my husband is ill", JSON.stringify(coachNote));
      const coachSees = await tryQ(db, `select count(*)::int as n from public.schedule_requests where id = $1`, [reqId]);
      h.check("the coach sees the request", coachSees.rows?.[0]?.n === 1);
      await h.as(admin);
      const adminNote = await tryQ(db, `select count(*)::int as n from public.schedule_request_notes where request_id = $1`, [reqId]);
      h.check("an org admin reads the request and the note", adminNote.rows?.[0]?.n === 1, JSON.stringify(adminNote));
      await h.as(outsider);
      const outReq = await tryQ(db, `select count(*)::int as n from public.schedule_requests`);
      const outNote = await tryQ(db, `select count(*)::int as n from public.schedule_request_notes`);
      h.check("another coach in another organisation sees neither the request nor the note", outReq.rows?.[0]?.n === 0 && outNote.rows?.[0]?.n === 0, JSON.stringify({ outReq, outNote }));
      await h.as(bob);
      const bobSees = await tryQ(db, `select count(*)::int as n from public.schedule_requests`);
      h.check("another client in the same group does not see it", bobSees.rows?.[0]?.n === 0, JSON.stringify(bobSees));

      // ---- the notification: fixed wording, no kind, no note ----
      await h.asSuper();
      const notes = await h.rows(`select profile_id, type, body, link_path from public.notifications where type = 'schedule_request' and group_id = $1`, [group]);
      h.check("the coach is told with fixed wording (no kind and no note)", notes.length === 1 && notes[0].profile_id === coach && /sent a schedule request\.$/.test(notes[0].body) && !/pause|husband|ill/i.test(notes[0].body), JSON.stringify(notes));

      // ---- limits and checks ----
      await h.as(ann);
      const dup = await tryQ(db, `select public.request_schedule_change($1, 'cancel', $2, null, null)`, [annSeries, plus(5)]);
      h.check("a second open request for the same schedule is refused", /already have a request waiting/.test(dup.error ?? ""), JSON.stringify(dup));
      const other = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, null)`, [bobSeries, plus(3)]);
      h.check("a client cannot ask for someone else's schedule", /not authorized/.test(other.error ?? ""), JSON.stringify(other));
      await h.as(null);
      const anon = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, null)`, [annSeries, plus(3)]);
      h.check("a signed-out visitor cannot ask", !!anon.error, JSON.stringify(anon));
      await h.as(bob);
      const past = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, null)`, [bobSeries, plus(-1)]);
      h.check("a date in the past is refused", /today or a later date/.test(past.error ?? ""), JSON.stringify(past));
      const far = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, null)`, [bobSeries, plus(181)]);
      h.check("a date more than six months out is refused", /within the next six months/.test(far.error ?? ""), JSON.stringify(far));
      const bad = await tryQ(db, `select public.request_schedule_change($1, 'delete', $2, null, null)`, [bobSeries, plus(2)]);
      h.check("an unknown kind is refused", /choose pause, freeze or cancel/.test(bad.error ?? ""), JSON.stringify(bad));
      const noResume = await tryQ(db, `select public.request_schedule_change($1, 'freeze', $2, null, null)`, [bobSeries, plus(2)]);
      h.check("a freeze needs a day to start again", /day you want to start again/.test(noResume.error ?? ""), JSON.stringify(noResume));
      const early = await tryQ(db, `select public.request_schedule_change($1, 'freeze', $2, $3, null)`, [bobSeries, plus(5), plus(5)]);
      h.check("a freeze must start again after it begins", /after the freeze begins/.test(early.error ?? ""), JSON.stringify(early));
      const long = await tryQ(db, `select public.request_schedule_change($1, 'freeze', $2, $3, null)`, [bobSeries, plus(2), plus(2 + 85)]);
      h.check("a freeze longer than 12 weeks is refused", /up to 12 weeks/.test(long.error ?? ""), JSON.stringify(long));
      const resumeOnPause = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, $3, null)`, [bobSeries, plus(2), plus(20)]);
      h.check("only a freeze has a day to start again", /only a freeze/.test(resumeOnPause.error ?? ""), JSON.stringify(resumeOnPause));
      const longNote = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, $3)`, [bobSeries, plus(2), "x".repeat(501)]);
      h.check("a note over 500 characters is refused", /under 500/.test(longNote.error ?? ""), JSON.stringify(longNote));

      // ---- writes only through the functions ----
      const direct = await tryQ(db, `insert into public.schedule_requests (series_id, athlete_id, coach_id, group_id, kind, effective_on) values ($1, $2, $3, $4, 'pause', current_date)`, [bobSeries, bob, coach, group]);
      h.check("a client cannot write a request directly", !!direct.error, JSON.stringify(direct));
      const upd = await tryQ(db, `update public.schedule_requests set status = 'applied' where id = $1`, [reqId]);
      h.check("a client cannot change a request directly", !!upd.error || upd.rows?.length === 0, JSON.stringify(upd));
      await h.as(coach);
      const cdirect = await tryQ(db, `update public.schedule_requests set status = 'applied' where id = $1 returning id`, [reqId]);
      h.check("a coach cannot change a request directly either", !!cdirect.error || (cdirect.rows ?? []).length === 0, JSON.stringify(cdirect));
      const ndirect = await tryQ(db, `insert into public.schedule_request_notes (request_id, note) values ($1, 'x')`, [reqId]);
      h.check("nobody signed in can write a note directly", !!ndirect.error, JSON.stringify(ndirect));

      // ---- the server-only functions are closed to signed-in people ----
      for (const [who, label] of [[ann, "a client"], [coach, "a coach"]]) {
        await h.as(who);
        const calls = [
          [`select public.claim_schedule_request($1, true)`, [reqId]],
          [`select * from public.claim_due_schedule_requests(5)`, []],
          [`select public.finish_schedule_request($1, true, false, false, null)`, [reqId]],
          [`select public.end_schedule_freeze($1, null)`, [annSeries]],
          [`select * from public.claim_due_freeze_resumes(5)`, []],
          [`select public.fail_freeze_resume($1, 'x')`, [annSeries]],
          [`select public.note_schedule_resumed($1, 1, 0)`, [annSeries]],
          [`select public.extend_expiry_for_freeze($1, $2, $3, 5, 'x')`, [ann, group, coach]],
          [`select public.schedule_local_today('UTC', $1)`, [coach]],
        ];
        const results = [];
        for (const [sql, p] of calls) results.push((await tryQ(db, sql, p)).error ?? "");
        h.check(`${label} cannot run any of the server-only schedule functions`, results.every((e) => /permission denied|not authorized/i.test(e)), JSON.stringify(results));
      }

      // ---- withdraw, dismiss ----
      await h.as(bob);
      const bw = await tryQ(db, `select public.withdraw_schedule_request($1)`, [reqId]);
      h.check("another client cannot withdraw someone else's request", /not authorized/.test(bw.error ?? ""), JSON.stringify(bw));
      await h.as(ann);
      const dis = await tryQ(db, `select public.dismiss_schedule_request($1)`, [reqId]);
      h.check("a client cannot mark a request handled", /not authorized/.test(dis.error ?? ""), JSON.stringify(dis));
      await h.as(outsider);
      const dis2 = await tryQ(db, `select public.dismiss_schedule_request($1)`, [reqId]);
      h.check("a coach of another organisation cannot mark it handled", /not authorized/.test(dis2.error ?? ""), JSON.stringify(dis2));
      await h.as(ann);
      const w = await tryQ(db, `select public.withdraw_schedule_request($1)`, [reqId]);
      h.check("the client withdraws their own pending request", !w.error, JSON.stringify(w));
      const w2 = await tryQ(db, `select public.withdraw_schedule_request($1)`, [reqId]);
      h.check("a withdrawn request cannot be withdrawn twice", /already handled/.test(w2.error ?? ""), JSON.stringify(w2));
      const again = await tryQ(db, `select public.request_schedule_change($1, 'freeze', $2, $3, null) as id`, [annSeries, plus(1), plus(15)]);
      h.check("after a withdraw the client can ask again", !again.error, JSON.stringify(again));
      const frzId = again.rows?.[0]?.id;
      await h.as(admin);
      const adminDismiss = await tryQ(db, `select public.dismiss_schedule_request($1)`, [frzId]);
      h.check("an org admin marks a request handled (nothing about the schedule changes)", !adminDismiss.error, JSON.stringify(adminDismiss));
      await h.asSuper();
      h.check("a handled request left the schedule alone", (await h.one(`select status, frozen_from from public.recurring_booking_series where id = $1`, [annSeries])).status === "active");

      // ---- daily limit: three a day ----
      await h.as(bob);
      for (let i = 0; i < 3; i++) {
        const r = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, null) as id`, [bobSeries, plus(2)]);
        if (r.error) { h.check(`bob's request ${i + 1} of 3 goes through`, false, r.error); break; }
        await tryQ(db, `select public.withdraw_schedule_request($1)`, [r.rows[0].id]);
      }
      const fourth = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, null)`, [bobSeries, plus(2)]);
      h.check("a fourth request in a day is refused (message your coach)", /a few requests today/.test(fourth.error ?? ""), JSON.stringify(fourth));

      // ---- the server applies: the daily run ----
      const sv = await scene(h, db, "S2");
      const sToday = (await h.one(`select public.schedule_local_today('America/New_York', $1) as d`, [sv.coach])).d;
      const sPlus = (n) => { const d = new Date(sToday); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
      const sTodayS = new Date(sToday).toISOString().slice(0, 10);
      await h.asSuper();
      // a coach with a 60-day expiry window; the client has 8 sessions granted 50 days ago
      await db.query(`insert into public.coach_booking_policies (coach_id, credit_expiry_days) values ($1, 60) on conflict (coach_id) do update set credit_expiry_days = 60`, [sv.coach]);
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance, last_granted_at) values ($1, $2, 8, now() - interval '50 days')`, [sv.ann, sv.group]);
      await h.as(sv.ann);
      const fr = await tryQ(db, `select public.request_schedule_change($1, 'freeze', $2, $3, 'travelling') as id`, [sv.annSeries, sPlus(0), sPlus(21)]);
      const frId = fr.rows?.[0]?.id;
      h.check("a client asks for a freeze for three weeks starting today", !fr.error && !!frId, JSON.stringify(fr));

      await h.asService();
      const none = await tryQ(db, `select * from public.claim_due_schedule_requests(10)`);
      h.check("a request dated today is not due yet (it applies once its day has ended)", (none.rows ?? []).length === 0 && !none.error, JSON.stringify(none));
      const tooSoon = await tryQ(db, `select public.claim_schedule_request($1, true)`, [frId]);
      h.check("Done on a request dated today is allowed and counts as early", !tooSoon.error && tooSoon.rows?.[0]?.claim_schedule_request?.early === true && tooSoon.rows[0].claim_schedule_request.kind === "freeze", JSON.stringify(tooSoon));
      const second = await tryQ(db, `select public.claim_schedule_request($1, true)`, [frId]);
      h.check("a second claim at the same moment loses (being applied right now)", /being applied right now/.test(second.error ?? ""), JSON.stringify(second));
      const withdrawBusy = await (async () => { await h.as(sv.ann); const r = await tryQ(db, `select public.withdraw_schedule_request($1)`, [frId]); await h.asService(); return r; })();
      h.check("a request cannot be withdrawn while the schedule is being changed", /already changing/.test(withdrawBusy.error ?? ""), JSON.stringify(withdrawBusy));

      // finish: a failure first, then success
      await h.asService();
      await tryQ(db, `select public.finish_schedule_request($1, false, true, false, 'could not remove one session')`, [frId]);
      await h.asSuper();
      let row = await h.one(`select status, attempts, last_error from public.schedule_requests where id = $1`, [frId]);
      h.check("a failed apply goes back to pending with a short reason", row.status === "pending" && row.attempts === 1 && /could not remove/.test(row.last_error ?? ""), JSON.stringify(row));
      await h.asService();
      const again1 = await tryQ(db, `select public.claim_schedule_request($1, true)`, [frId]);
      h.check("a pending request can be claimed again", !again1.error, JSON.stringify(again1));
      const fin = await tryQ(db, `select public.finish_schedule_request($1, true, true, false, null)`, [frId]);
      h.check("finishing a claimed request works", !fin.error, JSON.stringify(fin));
      await h.asSuper();
      row = await h.one(`select status, applied_early from public.schedule_requests where id = $1`, [frId]);
      h.check("the request is applied and marked early", row.status === "applied" && row.applied_early === true, JSON.stringify(row));
      const ser = await h.one(`select frozen_from::text, frozen_until::text from public.recurring_booking_series where id = $1`, [sv.annSeries]);
      h.check("the schedule carries the freeze dates", ser.frozen_from === sTodayS && ser.frozen_until === sPlus(21), JSON.stringify({ ser, sTodayS }));
      const hold = await h.one(`select expiry_hold_until, last_granted_at, balance from public.session_credits where athlete_id = $1 and group_id = $2`, [sv.ann, sv.group]);
      const expectedDays = 60 + 21; // 60-day window counted from the grant, plus the 21 frozen days
      const heldDays = Math.round((new Date(hold.expiry_hold_until) - new Date(hold.last_granted_at)) / 86400000);
      h.check("the freeze moved the expiry out by its length (60 + 21 days after the grant)", heldDays === expectedDays, JSON.stringify({ heldDays, expectedDays }));
      const ledger = await h.rows(`select kind, amount, note, balance_after from public.session_credit_ledger where athlete_id = $1 and group_id = $2`, [sv.ann, sv.group]);
      h.check("the hold is written in the session ledger (amount 0, balance unchanged) with the reason", ledger.some((l) => l.kind === "adjusted" && l.amount === 0 && l.balance_after === 8 && /schedule frozen/.test(l.note)), JSON.stringify(ledger));
      const bal = hold.balance;
      h.check("no session was taken or given", bal === 8);
      const clientNotes = await h.rows(`select body from public.notifications where profile_id = $1 and type = 'schedule_applied'`, [sv.ann]);
      h.check("the client is told it was processed early, in plain words", clientNotes.length === 1 && /froze your weekly schedule now, ahead of/.test(clientNotes[0].body) && !/travelling/.test(clientNotes[0].body), JSON.stringify(clientNotes));
      const coachNotes = await h.rows(`select body from public.notifications where profile_id = $1 and type = 'schedule_applied'`, [sv.coach]);
      h.check("the coach is not told again about a change they applied themselves", coachNotes.length === 0, JSON.stringify(coachNotes));

      // the freeze ends: late resume adds only the extra days
      await h.asService();
      const e1 = await tryQ(db, `select public.end_schedule_freeze($1, $2) as extra`, [sv.annSeries, sPlus(24)]);
      h.check("a freeze that ran three days longer than planned adds exactly those days", e1.rows?.[0]?.extra === 3, JSON.stringify(e1));
      const e2 = await tryQ(db, `select public.end_schedule_freeze($1, $2) as extra`, [sv.annSeries, sPlus(30)]);
      h.check("ending a freeze twice does nothing the second time", e2.rows?.[0]?.extra === 0, JSON.stringify(e2));
      await h.asSuper();
      const hold2 = await h.one(`select expiry_hold_until, last_granted_at from public.session_credits where athlete_id = $1 and group_id = $2`, [sv.ann, sv.group]);
      h.check("the expiry is now 60 + 24 days after the grant", Math.round((new Date(hold2.expiry_hold_until) - new Date(hold2.last_granted_at)) / 86400000) === 84);
      const cleared = await h.one(`select frozen_from, frozen_until from public.recurring_booking_series where id = $1`, [sv.annSeries]);
      h.check("the freeze dates are cleared", cleared.frozen_from === null && cleared.frozen_until === null);

      // the nightly claim: due by the schedule's own day, three tries, stale claims reclaimed
      const sv2 = await scene(h, db, "S3");
      await h.as(sv2.ann);
      const pr = await tryQ(db, `select public.request_schedule_change($1, 'pause', $2, null, null) as id`, [sv2.annSeries, sPlus(0)]);
      const prId = pr.rows?.[0]?.id;
      await h.asSuper();
      await db.query(`update public.schedule_requests set effective_on = effective_on - 1, created_at = created_at - interval '2 days' where id = $1`, [prId]);
      await h.asService();
      const due = await tryQ(db, `select * from public.claim_due_schedule_requests(10)`);
      const claimed = (due.rows ?? []).map((r) => r.claim_due_schedule_requests);
      h.check("a request whose day has ended is claimed by the daily run (not early)", claimed.length === 1 && claimed[0].request_id === prId && claimed[0].early === false && claimed[0].kind === "pause", JSON.stringify(due));
      const dueAgain = await tryQ(db, `select * from public.claim_due_schedule_requests(10)`);
      h.check("a request already claimed is not handed out again", (dueAgain.rows ?? []).length === 0, JSON.stringify(dueAgain));
      await h.asSuper();
      await db.query(`update public.schedule_requests set claimed_at = now() - interval '11 minutes' where id = $1`, [prId]);
      await h.asService();
      const stale = await tryQ(db, `select * from public.claim_due_schedule_requests(10)`);
      h.check("a claim older than ten minutes is reclaimed", (stale.rows ?? []).length === 1, JSON.stringify(stale));
      await tryQ(db, `select public.finish_schedule_request($1, false, false, true, 'engine error')`, [prId]);
      const third = await tryQ(db, `select * from public.claim_due_schedule_requests(10)`);
      h.check("the third try is handed out", (third.rows ?? []).length === 1, JSON.stringify(third));
      await tryQ(db, `select public.finish_schedule_request($1, false, false, true, 'engine error')`, [prId]);
      const fourthTry = await tryQ(db, `select * from public.claim_due_schedule_requests(10)`);
      h.check("after three failed tries the daily run stops trying", (fourthTry.rows ?? []).length === 0, JSON.stringify(fourthTry));
      await h.asSuper();
      const failNotes = await h.rows(`select profile_id, body from public.notifications where type = 'schedule_applied' and profile_id = $1`, [sv2.coach]);
      h.check("the coach is told once, after the third failure, in plain words", failNotes.length === 1 && /could not be applied automatically/.test(failNotes[0].body), JSON.stringify(failNotes));
      // the coach still handles it by hand
      await h.as(sv2.coach);
      const hand = await tryQ(db, `select public.dismiss_schedule_request($1)`, [prId]);
      h.check("the coach can still mark it handled by hand", !hand.error, JSON.stringify(hand));

      // the daily run applies a cancel and tells the coach too
      await h.as(sv2.bob);
      const cn = await tryQ(db, `select public.request_schedule_change($1, 'cancel', $2, null, 'moving away') as id`, [sv2.bobSeries, sPlus(0)]);
      const cnId = cn.rows?.[0]?.id;
      await h.asSuper();
      await db.query(`update public.schedule_requests set effective_on = effective_on - 1 where id = $1`, [cnId]);
      await h.asService();
      const cdue = await tryQ(db, `select * from public.claim_due_schedule_requests(10)`);
      h.check("the cancel is due", (cdue.rows ?? []).length === 1);
      await tryQ(db, `select public.finish_schedule_request($1, true, false, true, null)`, [cnId]);
      await h.asSuper();
      const cNotes = await h.rows(`select profile_id, body from public.notifications where type = 'schedule_applied' and (profile_id = $1 or profile_id = $2) and body not like 'A schedule request%'`, [sv2.bob, sv2.coach]);
      h.check("the client and the coach are both told when the daily run applies it (no note in either)", cNotes.length === 2 && cNotes.every((n) => !/moving away/.test(n.body)), JSON.stringify(cNotes));

      // freezes restart on their day
      const sv3 = await scene(h, db, "S4");
      await h.asSuper();
      await db.query(`update public.recurring_booking_series set status = 'paused', frozen_from = current_date - 10, frozen_until = current_date - 1 where id = $1`, [sv3.annSeries]);
      await db.query(`update public.recurring_booking_series set status = 'paused', frozen_from = current_date, frozen_until = current_date + 30 where id = $1`, [sv3.bobSeries]);
      await h.asService();
      const res = await tryQ(db, `select * from public.claim_due_freeze_resumes(10)`);
      h.check("only the freeze whose day has come is handed out", (res.rows ?? []).length === 1 && res.rows[0].series_id === sv3.annSeries, JSON.stringify(res));
      const res2 = await tryQ(db, `select * from public.claim_due_freeze_resumes(10)`);
      h.check("a freeze already claimed is not handed out again", (res2.rows ?? []).length === 0, JSON.stringify(res2));
      await tryQ(db, `select public.fail_freeze_resume($1, 'dates could not be booked')`, [sv3.annSeries]);
      await h.asSuper();
      const f1 = await h.rows(`select body from public.notifications where type = 'schedule_resumed' and profile_id = $1`, [sv3.coach]);
      h.check("the coach is told the first time a restart fails", f1.length === 1 && /could not be restarted automatically/.test(f1[0].body), JSON.stringify(f1));
      await h.asService();
      await tryQ(db, `select * from public.claim_due_freeze_resumes(10)`);
      await tryQ(db, `select public.fail_freeze_resume($1, 'again')`, [sv3.annSeries]);
      await tryQ(db, `select * from public.claim_due_freeze_resumes(10)`);
      await tryQ(db, `select public.fail_freeze_resume($1, 'again')`, [sv3.annSeries]);
      const stop = await tryQ(db, `select * from public.claim_due_freeze_resumes(10)`);
      h.check("after three failures the daily run stops trying", (stop.rows ?? []).length === 0, JSON.stringify(stop));
      await h.asSuper();
      const f3 = await h.rows(`select body from public.notifications where type = 'schedule_resumed' and profile_id = $1`, [sv3.coach]);
      h.check("the coach is told again at the third failure and not in between", f3.length === 2, JSON.stringify(f3));
      await h.asService();
      await tryQ(db, `select public.note_schedule_resumed($1, 11, 2)`, [sv3.annSeries]);
      await h.asSuper();
      const resumed = await h.rows(`select profile_id, body from public.notifications where type = 'schedule_resumed' and body like '%started again%'`);
      h.check("a restart tells the coach how many sessions were booked and how many dates were not", resumed.length === 1 && /11 sessions booked, 2 dates could not be booked/.test(resumed[0].body), JSON.stringify(resumed));
      const clientBack = await h.rows(`select body from public.notifications where type = 'schedule_resumed' and profile_id = $1 and body like 'Your weekly schedule is back%'`, [sv3.ann]);
      h.check("the client is told it is back on", clientBack.length === 1);

      // a coach with no expiry window: a freeze changes nothing about credits
      const sv4 = await scene(h, db, "S5");
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance, last_granted_at) values ($1, $2, 5, now() - interval '30 days')`, [sv4.ann, sv4.group]);
      await h.as(sv4.ann);
      const nf = await tryQ(db, `select public.request_schedule_change($1, 'freeze', $2, $3, null) as id`, [sv4.annSeries, sPlus(0), sPlus(14)]);
      await h.asService();
      await tryQ(db, `select public.claim_schedule_request($1, true)`, [nf.rows?.[0]?.id]);
      await tryQ(db, `select public.finish_schedule_request($1, true, true, false, null)`, [nf.rows?.[0]?.id]);
      await h.asSuper();
      const noHold = await h.one(`select expiry_hold_until from public.session_credits where athlete_id = $1 and group_id = $2`, [sv4.ann, sv4.group]);
      h.check("with no expiry window a freeze leaves the credits alone (no hold)", noHold.expiry_hold_until === null, JSON.stringify(noHold));
    },
  },
};
