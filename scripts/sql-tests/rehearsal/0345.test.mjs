// 0345: the organization walls, in the database. Every simulated outsider (an owner, an admin, a coach, a client of another organization; a platform administrator who is not in the organization; a coach with
// no organization; a signed-in person with no membership) reads ZERO rows of organization A. Inside organization A: the owner sees everything, a coach sees only their own clients, a client sees their
// coach and teammates. Names (profiles) follow the same rule.
const DATA_TABLES_BY_GROUP = [
  "programs", "workouts", "coach_packages", "bookings", "daily_macros", "direct_messages", "posts", "athlete_notes", "session_credits", "credit_purchases",
  "membership_subscriptions", "coach_quick_payments", "client_intake", "group_invites", "athlete_sessions",
];

export default {
  name: "0345 organization walls: nothing of another organization is readable; names follow the same rule",
  migrations: ["0345"],
  phases: {
    async "0345"({ db, h }) {
      const aOwner = await h.user("OW A Owner");
      const aAdmin = await h.user("OW A Admin");
      const aCoach1 = await h.user("OW A Coach 1");
      const aCoach2 = await h.user("OW A Coach 2");
      const c1 = await h.user("OW A Client 1");
      const c2 = await h.user("OW A Teammate 2");
      const c3 = await h.user("OW A Solo 3");
      const c4 = await h.user("OW A Solo 4");
      const bOwner = await h.user("OW B Owner");
      const bAdmin = await h.user("OW B Admin");
      const bCoach = await h.user("OW B Coach");
      const bClient = await h.user("OW B Client");
      const noOrgCoach = await h.user("OW Coach No Org");
      const nobody = await h.user("OW Nobody");
      const platformAdmin = await h.user("OW Platform Admin");

      const orgA = await h.org(aOwner);
      await h.orgMember(orgA, aAdmin, "admin");
      await h.orgMember(orgA, aCoach1, "coach");
      await h.orgMember(orgA, aCoach2, "coach");
      const tA = await h.group(orgA, aCoach1, "team", "OW A team");
      const s3 = await h.group(orgA, aCoach1, "one_on_one", "OW A solo 3");
      const s4 = await h.group(orgA, aCoach2, "one_on_one", "OW A solo 4");
      await h.member(tA, c1);
      await h.member(tA, c2);
      await h.member(s3, c3);
      await h.member(s4, c4);

      const orgB = await h.org(bOwner);
      await h.orgMember(orgB, bAdmin, "admin");
      await h.orgMember(orgB, bCoach, "coach");
      const tB = await h.group(orgB, bCoach, "team", "OW B team");
      await h.member(tB, bClient);
      // a coach who has no organization membership at all (only a coach row in a group of organization B)
      await h.member(tB, noOrgCoach, "coach");

      await h.asSuper();
      await db.query(`update public.profiles set is_platform_admin = true where id = $1`, [platformAdmin]);

      // ---- organization A's data -------------------------------------------------
      const prog = async (group, who, name) => (await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active) values ($1, $2, $3, $4, true) returning id`, [group, name, aCoach1, who])).rows[0].id;
      await db.query("alter table public.programs disable trigger programs_guard_one_on_one");
      const pTeam = await prog(tA, null, "OW team program");
      const pSolo = await prog(s3, c3, "OW solo program");
      await db.query("alter table public.programs enable trigger programs_guard_one_on_one");
      await db.query(`insert into public.workouts (program_id, group_id, title, day_index, athlete_id) values ($1, $2, 'Day 1', 1, null), ($3, $4, 'Day 1', 1, $5)`, [pTeam, tA, pSolo, s3, c3]);
      await db.query(`insert into public.coach_packages (coach_id, group_id, name, sessions_per_week, billing_type, sessions_granted, rate_cents, is_active, is_public) values ($1, $2, 'OW pack', 1, 'one_time', 4, 6000, true, false)`, [aCoach1, s3]);
      await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at) values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 1 hour')`, [aCoach1, c3, s3]);
      await db.query(`insert into public.daily_macros (athlete_id, group_id, log_date, created_by) values ($1, $2, current_date, $3)`, [c3, s3, aCoach1]);
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'hello')`, [s3, aCoach1, c3]);
      await db.query(`insert into public.posts (group_id, author_id) values ($1, $2)`, [tA, c1]);
      await db.query(`insert into public.athlete_notes (group_id, created_by, athlete_id) values ($1, $2, $3)`, [s3, aCoach1, c3]);
      await db.query(`insert into public.session_credits (athlete_id, group_id) values ($1, $2)`, [c3, s3]);
      await db.query(`insert into public.credit_purchases (stripe_event_id, stripe_checkout_session_id, group_id, credits_purchased, amount_cents, athlete_id) values ('ow_e1', 'ow_s1', $1, 4, 24000, $2)`, [s3, c3]);
      await db.query(`insert into public.membership_subscriptions (athlete_id, group_id, stripe_subscription_id, status) values ($1, $2, 'ow_sub1', 'active')`, [c3, s3]);
      await db.query(`insert into public.coach_quick_payments (stripe_event_id, stripe_checkout_session_id, coach_id, athlete_id, group_id, amount_cents) values ('ow_e2', 'ow_s2', $1, $2, $3, 9000)`, [aCoach1, c3, s3]);
      await db.query(`insert into public.client_intake (athlete_id, group_id) values ($1, $2)`, [c3, s3]);
      await db.query(`insert into public.group_invites (group_id, code, created_by) values ($1, 'OWCODE1', $2)`, [tA, aCoach1]);
      await db.query(`insert into public.athlete_sessions (athlete_id, group_id) values ($1, $2)`, [c3, s3]);
      await db.query(`insert into public.coach_credits (coach_id) values ($1) on conflict do nothing`, [aCoach1]);
      await db.query(`insert into public.revenue_split_transfers (stripe_event_id, coach_id, organization_id, amount_cents) values ('ow_e3', $1, $2, 1000)`, [aCoach1, orgA]);
      await db.query(`insert into public.platform_fee_ledger (stripe_event_id, organization_id, gross_amount_cents, stripe_processing_fee_cents, platform_flat_fee_cents, net_amount_cents) values ('ow_e4', $1, 6000, 200, 100, 5700)`, [orgA]);
      await db.query(`insert into public.organization_billing (organization_id) values ($1) on conflict do nothing`, [orgA]);

      const groupsA = [tA, s3, s4];
      // how many of organization A's rows the signed-in person can read
      async function visibleA() {
        const out = {};
        for (const t of DATA_TABLES_BY_GROUP) {
          out[t] = (await db.query(`select count(*)::int as n from public.${t} where group_id = any($1)`, [groupsA])).rows[0].n;
        }
        out.group_memberships = (await db.query(`select count(*)::int as n from public.group_memberships where group_id = any($1)`, [groupsA])).rows[0].n;
        out.groups = (await db.query(`select count(*)::int as n from public.groups where id = any($1)`, [groupsA])).rows[0].n;
        out.revenue_split_transfers = (await db.query(`select count(*)::int as n from public.revenue_split_transfers where organization_id = $1`, [orgA])).rows[0].n;
        out.platform_fee_ledger = (await db.query(`select count(*)::int as n from public.platform_fee_ledger where organization_id = $1`, [orgA])).rows[0].n;
        out.organization_memberships = (await db.query(`select count(*)::int as n from public.organization_memberships where organization_id = $1`, [orgA])).rows[0].n;
        out.coach_credits = (await db.query(`select count(*)::int as n from public.coach_credits where coach_id = $1`, [aCoach1])).rows[0].n;
        return out;
      }
      const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
      const namesVisible = async (ids) => (await db.query(`select id from public.profiles where id = any($1)`, [ids])).rows.length;
      const aPeople = [aOwner, aAdmin, aCoach1, aCoach2, c1, c2, c3, c4];

      // ---- outsiders: ZERO ------------------------------------------------------------
      const outsiders = [
        ["an owner of organization B", bOwner],
        ["an admin of organization B", bAdmin],
        ["a coach of a team group in organization B", bCoach],
        ["a client in organization B", bClient],
        ["a coach with no organization membership", noOrgCoach],
        ["a signed-in person with no membership at all", nobody],
        ["a platform administrator who is not in organization A", platformAdmin],
      ];
      for (const [label, uid] of outsiders) {
        await h.as(uid);
        const v = await visibleA();
        h.check(`${label} reads zero rows of organization A`, total(v) === 0, JSON.stringify(Object.fromEntries(Object.entries(v).filter(([, n]) => n > 0))));
        // the platform administrator sees staff names (for support screens), never a client; everyone else sees no one
        const allowedNames = uid === platformAdmin ? 4 : 0;
        h.check(`...and no name of any client in organization A` + (uid === platformAdmin ? " (staff names only for the platform administrator)" : ""), (await namesVisible(aPeople)) === allowedNames && (await namesVisible([c1, c2, c3, c4])) === 0);
      }

      // ---- inside organization A ------------------------------------------------------
      await h.as(aOwner);
      const ownerSees = await visibleA();
      h.check("the owner of organization A sees its programs, clients, bookings and payments", ownerSees.programs >= 2 && ownerSees.bookings >= 1 && ownerSees.credit_purchases >= 1 && ownerSees.membership_subscriptions >= 1 && ownerSees.coach_quick_payments >= 1, JSON.stringify(ownerSees));
      h.check("...and every name in it", (await namesVisible(aPeople)) === aPeople.length);

      await h.as(aAdmin);
      const adminSees = await visibleA();
      h.check("an admin of organization A sees no more than the owner", total(adminSees) <= total(ownerSees), `${total(adminSees)} vs ${total(ownerSees)}`);

      await h.as(aCoach2);
      const coach2 = await visibleA();
      h.check("coach 2 of organization A sees none of coach 1's clients' data (programs, bookings, payments, messages, notes)", coach2.programs === 0 && coach2.bookings === 0 && coach2.credit_purchases === 0 && coach2.direct_messages === 0 && coach2.athlete_notes === 0 && coach2.membership_subscriptions === 0 && coach2.coach_quick_payments === 0 && coach2.athlete_sessions === 0, JSON.stringify(coach2));
      const coach2Names = (await db.query(`select id from public.profiles where id = any($1)`, [aPeople])).rows.map((r) => r.id);
      h.check("coach 2 sees their own client's name, not coach 1's clients' or teammates' names", coach2Names.includes(c4) && !coach2Names.includes(c3) && !coach2Names.includes(c1) && !coach2Names.includes(c2), coach2Names.length + " names");

      await h.as(aCoach1);
      const coach1 = await visibleA();
      h.check("coach 1 sees their own clients' programs, bookings and payments", coach1.programs >= 2 && coach1.bookings >= 1 && coach1.credit_purchases >= 1, JSON.stringify(coach1));
      const coach1Names = (await db.query(`select id from public.profiles where id = any($1)`, [aPeople])).rows.map((r) => r.id);
      h.check("...and their clients' names, but not coach 2's client", coach1Names.includes(c1) && coach1Names.includes(c3) && !coach1Names.includes(c4), coach1Names.length + " names");

      await h.as(c1);
      const client1 = await visibleA();
      h.check("a team client sees the team's program and posts, but not a solo client's data", client1.programs >= 1 && client1.bookings === 0 && client1.credit_purchases === 0 && client1.direct_messages === 0 && client1.coach_quick_payments === 0, JSON.stringify(client1));
      const c1Names = (await db.query(`select id from public.profiles where id = any($1)`, [aPeople])).rows.map((r) => r.id);
      h.check("...sees their coach, their teammate, the owner and themselves; not a solo client or the other coach", c1Names.includes(aCoach1) && c1Names.includes(c2) && c1Names.includes(aOwner) && c1Names.includes(c1) && !c1Names.includes(c3) && !c1Names.includes(c4) && !c1Names.includes(aCoach2), c1Names.length + " names");

      await h.as(c3);
      const solo3 = await visibleA();
      h.check("a solo client sees their own program, booking and messages, not the team's data", solo3.bookings >= 1 && solo3.direct_messages >= 1 && solo3.posts === 0, JSON.stringify(solo3));

      // ---- no way around it through the lookup functions ---------------------------------
      await h.as(bOwner);
      h.check("can_see_profile says no for a stranger in another organization", (await db.query(`select public.can_see_profile($1) as v`, [c3])).rows[0].v === false);
      await h.as(platformAdmin);
      h.check("a platform administrator can still see their own profile", (await namesVisible([platformAdmin])) === 1);
    },
  },
};
