// 0422: "Request to train with me" on a coach's public page. A request grants NOTHING until the coach approves. Under 13 is refused (and stays refused for 30 days), every waiting request is First L. with no photo, the
// younger of the known and the typed date of birth always wins, approving makes an ordinary client seat (their own one-on-one space), and every refusal is an answer in plain words.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};
const years = (n) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
};

export default {
  name: "0422 Request to train with me",
  migrations: ["0422"],
  phases: {
    async "0422"({ db, h }) {
      const coach = await h.user("RQ Coach");
      const otherCoach = await h.user("RQ Other Coach");
      const adult = await h.user("Adam Adult");
      const teen = await h.user("Tina Teen");
      const kid = await h.user("RQ Kid Under");
      const noDob = await h.user("RQ Nora NoDob");
      const mismatch = await h.user("Mia Mismatch");
      const org = await h.org(coach, "RQ Gym");
      const org2 = await h.org(otherCoach, "RQ Other Gym");
      await h.orgMember(org2, coach, "coach");
      await h.group(org, coach, "team", "RQ Team");
      await h.asSuper();

      const call = async (who, sql, params) => {
        await h.as(who);
        const r = await tryQ(db, sql, params);
        await h.asSuper();
        return r;
      };
      const submit = async (who, dob = null, c = coach) => {
        const r = await call(who, `select public.submit_client_request($1, $2) as r`, [c, dob]);
        return r.error ? { error: r.error } : r.rows[0].r;
      };
      const setPage = async (coachId, slug, enabled, accepts = true) => {
        await db.query(
          `insert into public.coach_booking_pages (coach_id, slug, enabled, accepts_requests) values ($1, $2, $3, $4)
             on conflict (coach_id) do update set enabled = excluded.enabled, accepts_requests = excluded.accepts_requests`,
          [coachId, slug, enabled, accepts],
        );
      };

      // ---- the column and its default
      let r = await tryQ(db, `select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'accepts_requests'`);
      h.check("the page switch exists, on by default, never empty", r.rows?.[0]?.column_default === "true" && r.rows[0].is_nullable === "NO", JSON.stringify(r));

      // ---- the page must be on and taking requests
      let a = await submit(adult, years(30));
      h.check("a coach with no public page is not taking requests", a.ok === false && a.code === "not_taking", JSON.stringify(a));
      await setPage(coach, "rq-coach", false);
      a = await submit(adult, years(30));
      h.check("a page that is switched off is not taking requests", a.ok === false && a.code === "not_taking", JSON.stringify(a));
      await setPage(coach, "rq-coach", true, false);
      a = await submit(adult, years(30));
      h.check("a page with the request switch off is not taking requests", a.ok === false && a.code === "not_taking", JSON.stringify(a));
      await setPage(coach, "rq-coach", true, true);
      a = await submit(coach, years(30));
      h.check("a coach cannot ask themselves", a.ok === false && a.code === "own_page", JSON.stringify(a));
      r = await call(null, `select public.submit_client_request($1, $2) as r`, [coach, years(30)]);
      h.check("a signed-out visitor cannot call it", !!r.error || r.rows[0].r.ok === false, JSON.stringify(r));

      // ---- the date of birth
      a = await submit(noDob, null);
      h.check("no date of birth on file or typed: asked for it", a.ok === false && a.code === "dob_needed", JSON.stringify(a));
      a = await submit(noDob, "2999-01-01");
      h.check("a date in the future is not a date", a.ok === false && a.code === "dob_invalid", JSON.stringify(a));
      a = await submit(kid, years(10));
      h.check("under 13 is refused in plain words", a.ok === false && a.code === "under_13" && /13/.test(a.message), JSON.stringify(a));
      a = await submit(kid, years(30));
      h.check("and typing an older date next does not get around it (held 30 days)", a.ok === false && a.code === "under_13", JSON.stringify(a));
      r = await tryQ(db, `select count(*)::int as n from public.client_requests where requester_id = $1`, [kid]);
      h.check("no request was made for the child", r.rows?.[0]?.n === 0, JSON.stringify(r));

      // ---- a good request
      a = await submit(adult, years(30));
      h.check("an adult's request is taken", a.ok === true && !!a.id, JSON.stringify(a));
      const adultReq = a.id;
      const again = await submit(adult, years(30));
      h.check("asking again returns the same waiting request, not a second", again.ok === true && again.id === adultReq, JSON.stringify(again));
      r = await tryQ(db, `select count(*)::int as n from public.client_requests where requester_id = $1`, [adult]);
      h.check("still one row", r.rows?.[0]?.n === 1, JSON.stringify(r));
      a = await submit(teen, years(15));
      h.check("a 15-year-old's request is taken (consent comes later, as for any new client)", a.ok === true, JSON.stringify(a));
      const teenReq = a.id;

      // ---- the coach sees First L., no photo, and only their own organization
      r = await call(coach, `select * from public.coach_client_requests('pending', $1)`, [org]);
      const names = (r.rows ?? []).map((x) => x.display_name).sort();
      h.check("the coach sees both, as First L. only", JSON.stringify(names) === JSON.stringify(["Adam A.", "Tina T."]), JSON.stringify(r));
      h.check("with no photo and no account id", (r.rows ?? []).every((x) => x.avatar_url === null && !("requester_id" in x) && !("profile_id" in x)), JSON.stringify(r.rows?.[0]));
      h.check("and the teen is marked as under 18", (r.rows ?? []).find((x) => x.display_name === "Tina T.")?.age_band === "teen" && (r.rows ?? []).find((x) => x.display_name === "Adam A.")?.age_band === "adult");
      r = await call(coach, `select public.coach_client_request_count($1) as n`, [org]);
      h.check("the badge counts 2 for this organization", r.rows?.[0]?.n === 2, JSON.stringify(r));
      r = await call(coach, `select public.coach_client_request_count($1) as n`, [org2]);
      h.check("and 0 for the coach's other organization", r.rows?.[0]?.n === 0, JSON.stringify(r));
      r = await call(coach, `select * from public.coach_client_requests('pending', $1)`, [org2]);
      h.check("whose list is empty", r.rows?.length === 0, JSON.stringify(r));

      // ---- who can read the table directly
      r = await call(coach, `select count(*)::int as n from public.client_requests`);
      h.check("the coach cannot read the table itself (no date of birth, no full name)", !r.error && r.rows[0].n === 0, JSON.stringify(r));
      r = await call(adult, `select id, status from public.client_requests`);
      h.check("the person who asked can read their own request, and only theirs", !r.error && r.rows.length === 1 && r.rows[0].id === adultReq, JSON.stringify(r));
      r = await call(otherCoach, `select count(*)::int as n from public.client_requests`);
      h.check("another coach reads none", !r.error && r.rows[0].n === 0, JSON.stringify(r));
      r = await call(adult, `update public.client_requests set status = 'approved' where id = $1`, [adultReq]);
      h.check("nobody can answer a request by writing the table", !!r.error || r.rows.length === 0, JSON.stringify(r));
      r = await call(adult, `select count(*)::int as n from public.client_request_blocks`);
      h.check("the hold list and the attempt list are not readable", !!r.error || r.rows[0].n === 0, JSON.stringify(r));

      // ---- approving
      r = await call(otherCoach, `select public.approve_client_request($1)`, [adultReq]);
      h.check("another coach cannot approve it", !!r.error && /not found/.test(r.error), JSON.stringify(r));
      r = await call(adult, `select public.approve_client_request($1)`, [adultReq]);
      h.check("the person who asked cannot approve it", !!r.error && /not found/.test(r.error), JSON.stringify(r));
      r = await call(coach, `select public.approve_client_request($1) as r`, [adultReq]);
      const ap = r.rows?.[0]?.r;
      h.check("the coach approves: a space is made", ap?.ok === true && !!ap.group_id && ap.age_band === "adult", JSON.stringify(r));
      r = await tryQ(db, `select g.name, g.group_kind, g.organization_id, (select count(*)::int from public.group_memberships m where m.group_id = g.id and m.role = 'coach' and m.profile_id = $2) as coaches, (select count(*)::int from public.group_memberships m where m.group_id = g.id and m.role = 'athlete' and m.profile_id = $3) as athletes, (select count(*)::int from public.group_memberships m where m.group_id = g.id) as total from public.groups g where g.id = $1`, [ap?.group_id, coach, adult]);
      h.check("their own one-on-one space, named for them, in the coach's organization, one coach and one client", r.rows?.[0]?.name === "Adam Adult" && r.rows[0].group_kind === "one_on_one" && r.rows[0].organization_id === org && r.rows[0].coaches === 1 && r.rows[0].athletes === 1 && r.rows[0].total === 2, JSON.stringify(r));
      r = await tryQ(db, `select (select date_of_birth from public.client_intake where athlete_id = $1) as intake, (select birthday from public.athlete_profile_details where athlete_id = $1) as profile`, [adult]);
      h.check("the date of birth went to the records", String(r.rows?.[0]?.intake?.toISOString?.().slice(0, 10) ?? r.rows?.[0]?.intake).slice(0, 10) === years(30) && String(r.rows?.[0]?.profile?.toISOString?.().slice(0, 10) ?? r.rows?.[0]?.profile).slice(0, 10) === years(30), JSON.stringify(r));
      r = await tryQ(db, `select status, result_group_id from public.client_requests where id = $1`, [adultReq]);
      h.check("the request is closed as approved", r.rows?.[0]?.status === "approved" && r.rows[0].result_group_id === ap?.group_id, JSON.stringify(r));
      r = await tryQ(db, `select body from public.notifications where profile_id = $1 and type = 'client_request_answer'`, [adult]);
      h.check("the person is told, in words, what happens next", r.rows?.length === 1 && /accepted/.test(r.rows[0].body) && /health form/.test(r.rows[0].body), JSON.stringify(r));
      r = await call(coach, `select public.approve_client_request($1)`, [adultReq]);
      h.check("approving twice is refused", !!r.error && /already answered/.test(r.error), JSON.stringify(r));
      await db.query(`delete from public.client_request_attempts`);
      a = await submit(adult, years(30));
      h.check("a person who already trains with this coach is told so", a.ok === false && a.code === "already_client", JSON.stringify(a));

      // ---- the teen: approved as a client, told a guardian must sign
      r = await call(coach, `select public.approve_client_request($1) as r`, [teenReq]);
      h.check("the teen is approved with the age group named", r.rows?.[0]?.r?.ok === true && r.rows[0].r.age_band === "teen", JSON.stringify(r));
      r = await tryQ(db, `select body from public.notifications where profile_id = $1 and type = 'client_request_answer'`, [teen]);
      h.check("and told a parent or guardian has to sign before they log workouts", /guardian/.test(r.rows?.[0]?.body ?? ""), JSON.stringify(r));

      // ---- decline
      const declined = await h.user("RQ Dan Decline");
      a = await submit(declined, years(25));
      r = await call(coach, `select public.decline_client_request($1)`, [a.id]);
      h.check("a decline works", !r.error, JSON.stringify(r));
      r = await tryQ(db, `select body from public.notifications where profile_id = $1 and type = 'client_request_answer'`, [declined]);
      h.check("and says only that the coach is not taking new clients now", r.rows?.length === 1 && /not taking new clients right now/.test(r.rows[0].body), JSON.stringify(r));
      a = await submit(declined, years(25));
      h.check("asking again within 30 days is refused, gently", a.ok === false && a.code === "declined_recently", JSON.stringify(a));
      await db.query(`update public.client_requests set decided_at = now() - interval '31 days' where requester_id = $1`, [declined]);
      a = await submit(declined, years(25));
      h.check("after 30 days they may ask again", a.ok === true, JSON.stringify(a));

      // ---- the younger date of birth always wins, and an older age group on file stops the approval
      await db.query(`insert into public.athlete_profile_details (athlete_id, birthday) values ($1, $2)`, [mismatch, years(30)]);
      const grp = await h.group(org2, otherCoach, "one_on_one", "RQ Mia old space");
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [grp, mismatch]);
      await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, $3)`, [mismatch, grp, years(30)]);
      a = await submit(mismatch, years(15));
      h.check("a younger date typed over an older one on file is the one kept", a.ok === true, JSON.stringify(a));
      r = await tryQ(db, `select requester_dob from public.client_requests where id = $1`, [a.id]);
      h.check("the request holds the YOUNGER date", String(r.rows?.[0]?.requester_dob?.toISOString?.().slice(0, 10) ?? r.rows?.[0]?.requester_dob).slice(0, 10) === years(15), JSON.stringify(r));
      r = await call(coach, `select public.approve_client_request($1) as r`, [a.id]);
      h.check("approval is refused while the date on file says an older age group", r.rows?.[0]?.r?.ok === false && r.rows[0].r.code === "dob_mismatch" && /support/.test(r.rows[0].r.message), JSON.stringify(r));
      r = await tryQ(db, `select status from public.client_requests where id = $1`, [a.id]);
      h.check("and the request is still waiting", r.rows?.[0]?.status === "pending", JSON.stringify(r));
      r = await tryQ(db, `select count(*)::int as n from public.groups where organization_id = $1 and name = 'Mia Mismatch'`, [org]);
      h.check("no space was made", r.rows?.[0]?.n === 0, JSON.stringify(r));

      // ---- under 13 found at approval time closes it for good
      const late = await h.user("RQ Lee Late");
      a = await submit(late, years(20));
      await db.query(`insert into public.athlete_profile_details (athlete_id, birthday) values ($1, $2) on conflict (athlete_id) do update set birthday = excluded.birthday`, [late, years(10)]);
      r = await call(coach, `select public.approve_client_request($1) as r`, [a.id]);
      h.check("a child found at approval is closed, not approved", r.rows?.[0]?.r?.ok === false && r.rows[0].r.code === "under_13", JSON.stringify(r));
      r = await tryQ(db, `select status from public.client_requests where id = $1`, [a.id]);
      h.check("closed for good", r.rows?.[0]?.status === "expired", JSON.stringify(r));
      r = await tryQ(db, `select until > now() + interval '29 days' as held from public.client_request_blocks where profile_id = $1`, [late]);
      h.check("and held for 30 days", r.rows?.[0]?.held === true, JSON.stringify(r));
      r = await tryQ(db, `select body from public.notifications where profile_id = $1 and type = 'client_request_answer'`, [late]);
      h.check("with only the neutral notice", r.rows?.length === 1 && /not taking new clients right now/.test(r.rows[0].body) && !/13/.test(r.rows[0].body), JSON.stringify(r));

      // ---- a coach who has left the organization
      const gone = await h.user("RQ Gus Gone");
      a = await submit(gone, years(22));
      await db.query(`delete from public.organization_memberships where profile_id = $1 and organization_id = $2`, [coach, org]);
      await db.query(`delete from public.organization_memberships where profile_id = $1 and organization_id = $2`, [coach, org2]);
      r = await call(coach, `select public.approve_client_request($1) as r`, [a.id]);
      h.check("a coach who can no longer take clients there: the request is closed with a plain word", r.rows?.[0]?.r?.ok === false && r.rows[0].r.code === "expired", JSON.stringify(r));
      a = await submit(await h.user("RQ Hal Homeless"), years(22));
      h.check("and a coach in no organization is not taking requests", a.ok === false && a.code === "not_taking", JSON.stringify(a));
      await h.orgMember(org, coach, "owner");

      // ---- the page's organization: the one they OWN before one they only help run
      await h.orgMember(org2, coach, "coach");
      r = await tryQ(db, `select public.client_request_org($1) as o`, [coach]);
      h.check("an owned organization comes before one they only coach in", r.rows?.[0]?.o === org, JSON.stringify(r));

      // ---- limits
      const spam = await h.user("RQ Sam Spammer");
      await setPage(coach, "rq-coach", false);
      let last;
      for (let i = 0; i < 6; i++) last = await submit(spam, years(25));
      h.check("more than 5 tries an hour from one account are refused, refusals counted", last.ok === false && last.code === "too_many", JSON.stringify(last));
      await setPage(coach, "rq-coach", true);
      await db.query(`delete from public.client_request_attempts`);
      for (let i = 0; i < 50; i++) {
        const u = await h.user("RQ Filler " + i);
        await db.query(`insert into public.client_requests (coach_id, organization_id, requester_id, requester_dob, created_at) values ($1, $2, $3, $4, now() - interval '3 hours')`, [coach, org, u, years(30)]);
      }
      a = await submit(await h.user("RQ Fred Final"), years(30));
      h.check("a coach with 50 waiting requests is full", a.ok === false && a.code === "coach_full", JSON.stringify(a));

      // ---- decline all
      r = await call(coach, `select public.decline_all_client_requests($1) as n`, [org]);
      h.check("Decline all answers every waiting request in the organization at once", !r.error && r.rows[0].n >= 50, JSON.stringify(r));
      r = await tryQ(db, `select count(*)::int as n from public.client_requests where coach_id = $1 and status = 'pending'`, [coach]);
      h.check("none left waiting", r.rows?.[0]?.n === 0, JSON.stringify(r));
      r = await call(otherCoach, `select public.decline_all_client_requests($1) as n`, [org]);
      h.check("another coach declining declines nothing of this coach's", !r.error && r.rows[0].n === 0, JSON.stringify(r));
    },
  },
};
