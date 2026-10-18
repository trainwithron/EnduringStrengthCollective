// 0415: minor_may_write(), the one question "may this person write things other people will see?" Nothing uses it yet; this checks the answer for every kind of person and the age boundaries.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0415 minor_may_write",
  migrations: ["0415"],
  phases: {
    async "0415"({ db, h }) {
      const owner = await h.user("MW Owner");
      const coach = await h.user("MW Coach");
      const org = await h.org(owner, "MW Gym");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "MW Team");

      // a client with a given date of birth (null = none on file) and an optional guardian state
      const client = async (name, dob, consent) => {
        const u = await h.user(name);
        await h.member(g, u);
        await h.asSuper();
        if (dob !== undefined) await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, ${dob === null ? "null" : `(${dob})`})`, [u, g]);
        if (consent) await db.query(`insert into public.guardian_consents (athlete_id, guardian_email, token_hash, status) values ($1, 'p@example.com', $2, $3)`, [u, "h-" + u, consent]);
        return u;
      };
      // the question is asked as the person it is about (that is how the table policies ask it)
      const may = async (who) => {
        await h.as(who);
        const r = await tryQ(db, `select public.minor_may_write($1) as ok`, [who]);
        await h.asSuper();
        // the signed-out visitor is not even allowed to ask (the function is not granted to them): same as not allowed
        if (r.error && /permission denied/i.test(r.error)) return false;
        return r.error ? "ERROR " + r.error : r.rows[0].ok;
      };
      const years = (n, extraDays = 0) => `current_date - interval '${n} years' + interval '${extraDays} days'`;

      // ---- who is never asked
      h.check("a coach is allowed", (await may(coach)) === true);
      h.check("the organization owner (no athlete seat) is allowed", (await may(owner)) === true);
      const stranger = await h.user("MW Stranger");
      h.check("someone with no seat at all is allowed", (await may(stranger)) === true);
      const coachAndClient = await h.user("MW Coach Client");
      await h.member(g, coachAndClient, "athlete");
      await h.group(org, coachAndClient, "team", "MW Own Team");
      h.check("a coach who is also someone's client is allowed", (await may(coachAndClient)) === true);
      h.check("no signed-in person is not allowed", (await may(null)) === false);

      // ---- clients: the date of birth is the one place that counts
      const noDate = await client("MW No Date", null);
      h.check("a client with no date of birth is NOT allowed (unknown age counts as not an adult)", (await may(noDate)) === false);
      const noIntakeRow = await client("MW No Intake Row");
      h.check("a client with no intake row at all is NOT allowed", (await may(noIntakeRow)) === false);
      const adult = await client("MW Adult", years(30));
      h.check("an adult client is allowed", (await may(adult)) === true);
      const child = await client("MW Child", years(10));
      h.check("a child under 13 is NOT allowed", (await may(child)) === false);
      const childSigned = await client("MW Child Signed", years(10), "signed");
      h.check("a child under 13 is NOT allowed even with a signature on file", (await may(childSigned)) === false);

      // ---- 13 to 17 needs a signed guardian
      const teen = await client("MW Teen", years(15));
      h.check("a teen with no guardian request is NOT allowed", (await may(teen)) === false);
      const teenPending = await client("MW Teen Pending", years(15), "pending");
      h.check("a teen whose guardian has not signed yet is NOT allowed", (await may(teenPending)) === false);
      const teenWithdrawn = await client("MW Teen Withdrawn", years(15), "withdrawn");
      h.check("a teen whose guardian took consent back is NOT allowed", (await may(teenWithdrawn)) === false);
      const teenSigned = await client("MW Teen Signed", years(15), "signed");
      h.check("a teen with a signed guardian is allowed", (await may(teenSigned)) === true);

      // ---- the birthday boundaries, both sides
      const turns13Today = await client("MW Turns 13 Today", years(13), "signed");
      h.check("on the 13th birthday a signed teen is allowed", (await may(turns13Today)) === true);
      const turns13Tomorrow = await client("MW Turns 13 Tomorrow", years(13, 1), "signed");
      h.check("the day before the 13th birthday even a signed child is NOT allowed", (await may(turns13Tomorrow)) === false);
      const turns18Today = await client("MW Turns 18 Today", years(18));
      h.check("on the 18th birthday no guardian is needed", (await may(turns18Today)) === true);
      const turns18Tomorrow = await client("MW Turns 18 Tomorrow", years(18, 1));
      h.check("the day before the 18th birthday, with no guardian, is NOT allowed", (await may(turns18Tomorrow)) === false);
      const turns18TomorrowSigned = await client("MW Turns 18 Tomorrow Signed", years(18, 1), "signed");
      h.check("the day before the 18th birthday, with a guardian, is allowed", (await may(turns18TomorrowSigned)) === true);

      // ---- the leap-day rule matches the page gate (29 February counts from 1 March in a year that has none)
      const dates = [
        ["2008-02-29", 18, "2026-03-01"],
        ["2012-02-29", 13, "2025-03-01"],
        ["2004-02-29", 18, "2022-03-01"],
        ["2000-02-29", 24, "2024-02-29"],
        ["2010-07-15", 13, "2023-07-15"],
        ["2010-12-31", 18, "2028-12-31"],
      ];
      for (const [dob, n, want] of dates) {
        const r = await tryQ(db, `select public.age_threshold_date($1::date, $2)::text as d`, [dob, n]);
        h.check(`${dob} + ${n} years is ${want}`, r.rows?.[0]?.d === want, JSON.stringify(r));
      }

      // ---- staff: an organization role or a front-desk seat. Staff pass unless a date on file shows under 18.
      const staffNoDate = await client("MW Staff No Date");
      await h.orgMember(org, staffNoDate, "admin");
      h.check("staff who also train, no date on file: allowed", (await may(staffNoDate)) === true);
      const staffAdult = await client("MW Staff Adult", years(40));
      await h.orgMember(org, staffAdult, "admin");
      h.check("staff with an adult date: allowed", (await may(staffAdult)) === true);
      const staffTeen = await client("MW Staff Teen", years(15));
      await h.orgMember(org, staffTeen, "admin");
      h.check("staff whose date shows a teen are held to the client rule, unsigned: NOT allowed", (await may(staffTeen)) === false);
      const staffTeenSigned = await client("MW Staff Teen Signed", years(15), "signed");
      await h.orgMember(org, staffTeenSigned, "admin");
      h.check("a staff teen with a signed guardian: allowed", (await may(staffTeenSigned)) === true);
      // the younger of the two dates counts: an adult-looking intake date with a child's profile birthday
      const staffMixed = await client("MW Staff Mixed", years(40));
      await h.orgMember(org, staffMixed, "admin");
      await db.query(`insert into public.athlete_profile_details (athlete_id, birthday) values ($1, current_date - interval '12 years')`, [staffMixed]);
      h.check("staff with an adult intake date but a child's profile birthday: held to the client rule, adult date, allowed", (await may(staffMixed)) === true);
      const staffProfileOnly = await client("MW Staff Profile Only");
      await h.orgMember(org, staffProfileOnly, "admin");
      await db.query(`insert into public.athlete_profile_details (athlete_id, birthday) values ($1, current_date - interval '12 years')`, [staffProfileOnly]);
      h.check("staff whose only date is a child's profile birthday: NOT allowed", (await may(staffProfileOnly)) === false);
      const frontDesk = await client("MW Front Desk Teen", years(16));
      await db.query(`insert into public.org_front_desk (organization_id, profile_id) values ($1, $2)`, [org, frontDesk]);
      h.check("a front-desk seat does not switch the age rules off for a known teen", (await may(frontDesk)) === false);

      // ---- it answers only about the caller
      await h.as(adult);
      let ask = await tryQ(db, `select public.minor_may_write($1) as ok`, [child]);
      const other = await tryQ(db, `select public.minor_may_write($1) as ok`, [adult === child ? coach : "00000000-0000-4000-8000-0000000000aa"]);
      h.check("an adult asking about a child gets false, the same as asking about a stranger (no hint who is a minor)", ask.rows?.[0]?.ok === false && other.rows?.[0]?.ok === false, JSON.stringify([ask, other]));
      ask = await tryQ(db, `select public.minor_may_write($1) as ok`, [teenSigned]);
      h.check("nor does it reveal a signed guardian", ask.rows?.[0]?.ok === false);
      await h.asService();
      ask = await tryQ(db, `select public.minor_may_write($1) as ok`, [teenSigned]);
      h.check("the server can ask about anyone", ask.rows?.[0]?.ok === true, JSON.stringify(ask));
      await h.asSuper();

      // ---- an impossible date does not make it raise
      const weird = await client("MW Infinity", "'infinity'::date");
      h.check("a date of birth of infinity counts as no date: not allowed, and no error", (await may(weird)) === false);
      const weirdStaff = await client("MW Infinity Staff", "'-infinity'::date");
      await h.orgMember(org, weirdStaff, "admin");
      h.check("the same for staff: no usable date, so they pass, and no error", (await may(weirdStaff)) === true);

      // ---- who can call it
      await h.as(adult);
      let r = await tryQ(db, `select public.minor_may_write() as ok`);
      h.check("a signed-in person can ask about themselves with no argument" + (r.error ? ": " + r.error : ""), r.rows?.[0]?.ok === true);
      await h.as(null);
      r = await tryQ(db, `select public.minor_may_write($1) as ok`, [adult]);
      h.check("the signed-out visitor cannot call it", !!r.error);
      await h.asSuper();
    },
  },
};
