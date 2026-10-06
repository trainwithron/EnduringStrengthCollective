// 0284: a coach can propose a goal to a client; the client confirms it as it is, changes it (a counter-proposal that goes back to the coach) or declines it.
// A coach cannot confirm a goal for the client. Before 0284 only a client proposed and only a coach confirmed.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

async function setup(db, h, label) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const bob = await h.user(`${label} Bob`);
  const other = await h.user(`${label} Other Coach`);
  const stranger = await h.user(`${label} Stranger`);
  const coach2 = await h.user(`${label} Second Coach`);
  const org = await h.org(coach);
  const group = await h.group(org, coach, "team", `${label} group`);
  await h.member(group, ann);
  await h.member(group, bob);
  await h.member(group, coach2, "coach");
  await h.asSuper();
  return { coach, ann, bob, other, stranger, coach2, group };
}
const goal = async (h, id) => (await h.one(`select status, created_by, confirmed_by, target_date::text as target_date from public.client_goals where id = $1`, [id]));
const notices = async (h, profile, type) => (await h.rows(`select body from public.notifications where profile_id = $1 and type = $2 order by created_at`, [profile, type]));

export default {
  name: "0284 a coach proposes a goal and the client answers it",
  migrations: ["0284"],
  phases: {
    async "0283"({ db, h }) {
      const s = await setup(db, h, "G0");
      await h.as(s.coach);
      const r = await tryQ(db, `insert into public.client_goals (athlete_id, group_id, goal_type, status, created_by) values ($1, $2, 'muscle_gain', 'proposed', $3)`, [s.ann, s.group, s.coach]);
      await h.asSuper();
      h.check("baseline: a coach cannot propose a goal for a client (only the client could)", !!r.error, JSON.stringify(r));
    },

    async "0284"({ db, h }) {
      const s = await setup(db, h, "G1");
      const mk = (who, athlete, extra = "") => tryQ(db, `insert into public.client_goals (athlete_id, group_id, goal_type, status, created_by, target_date${extra}) values ($1, $2, 'muscle_gain', 'proposed', $3, '2027-03-01') returning id`, [athlete, s.group, who]);

      // ---- the coach proposes
      await h.as(s.coach);
      const proposed = await mk(s.coach, s.ann);
      const noOne = await tryQ(db, `insert into public.client_goals (athlete_id, group_id, goal_type, status, created_by) values ($1, $2, 'muscle_gain', 'confirmed', $3)`, [s.ann, s.group, s.coach]);
      const notClient = await tryQ(db, `insert into public.client_goals (athlete_id, group_id, goal_type, status, created_by) values ($1, $2, 'muscle_gain', 'proposed', $3)`, [s.stranger, s.group, s.coach]);
      await h.as(s.other);
      const byOther = await tryQ(db, `insert into public.client_goals (athlete_id, group_id, goal_type, status, created_by) values ($1, $2, 'muscle_gain', 'proposed', $3)`, [s.ann, s.group, s.other]);
      await h.asSuper();
      const g1 = proposed.rows?.[0]?.id;
      h.check("a coach proposes a goal for their own client (status proposed, authored by the coach)", !proposed.error && (await goal(h, g1)).created_by === s.coach, JSON.stringify(proposed));
      h.check("a coach cannot insert an already confirmed goal, or one for someone who is not their client, and an unrelated coach cannot at all", !!noOne.error && !!notClient.error && !!byOther.error, JSON.stringify({ noOne, notClient, byOther }));
      h.check("the client is told (a goal_proposed notice)", (await notices(h, s.ann, "goal_proposed")).length === 1, JSON.stringify(await notices(h, s.ann, "goal_proposed")));

      // ---- the coach cannot confirm it for the client
      await h.as(s.coach);
      const selfConfirm = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [g1]);
      await h.asSuper();
      h.check("a coach cannot confirm a goal they proposed", /Only the client can confirm/.test(selfConfirm.error ?? "") && (await goal(h, g1)).status === "proposed", JSON.stringify(selfConfirm));

      // ---- another client cannot answer it; a client cannot answer one they proposed themselves
      await h.as(s.bob);
      const byBob = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1 returning id`, [g1]);
      await h.as(s.ann);
      const own = await mk(s.ann, s.ann);
      const gOwn = own.rows?.[0]?.id;
      const ownAnswer = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [gOwn]);
      await h.asSuper();
      h.check("another client cannot answer it", (byBob.rows ?? []).length === 0 && (await goal(h, g1)).status === "proposed", JSON.stringify(byBob));
      h.check("a client cannot confirm a goal they proposed themselves (their coach does that)", !!ownAnswer.error || (await goal(h, gOwn)).status === "proposed", JSON.stringify(ownAnswer));

      // ---- the client confirms it as it is
      await h.as(s.ann);
      const yes = await tryQ(db, `update public.client_goals set status = 'confirmed', confirmed_by = $2 where id = $1`, [g1, s.bob]);
      await h.asSuper();
      const after = await goal(h, g1);
      h.check("the client confirms it as it is; who confirmed it comes from the caller, not from what was sent", !yes.error && after.status === "confirmed" && after.confirmed_by === s.ann, JSON.stringify({ yes, after }));
      h.check("the coach is told (a goal_answered notice)", (await notices(h, s.coach, "goal_answered")).some((n) => /confirmed/.test(n.body)), JSON.stringify(await notices(h, s.coach, "goal_answered")));

      // ---- counter-proposal and coach confirmation
      await h.as(s.coach);
      const p2 = await mk(s.coach, s.ann);
      await h.asSuper();
      const g2 = p2.rows[0].id;
      await h.as(s.ann);
      const counter = await tryQ(db, `update public.client_goals set target_date = '2027-06-01' where id = $1`, [g2]);
      await h.asSuper();
      const c2 = await goal(h, g2);
      h.check("the client changes it: it goes back to the coach, authored by the client, still proposed", !counter.error && c2.status === "proposed" && c2.created_by === s.ann && c2.target_date === "2027-06-01", JSON.stringify({ counter, c2 }));
      await h.as(s.coach);
      const coachOk = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [g2]);
      await h.asSuper();
      const c2b = await goal(h, g2);
      h.check("the coach can then confirm the client's version", !coachOk.error && c2b.status === "confirmed" && c2b.confirmed_by === s.coach, JSON.stringify({ coachOk, c2b }));

      // ---- the coach changing a client's proposal sends it back instead of confirming
      await h.as(s.ann);
      const p3 = await mk(s.ann, s.ann);
      await h.asSuper();
      const g3 = p3.rows[0].id;
      await h.as(s.coach);
      await tryQ(db, `update public.client_goals set target_date = '2027-09-01', status = 'confirmed' where id = $1`, [g3]);
      await h.asSuper();
      const c3 = await goal(h, g3);
      h.check("a coach who changes a client's proposal sends it back to the client; it is not confirmed", c3.status === "proposed" && c3.created_by === s.coach && c3.confirmed_by === null, JSON.stringify(c3));

      // ---- decline
      await h.as(s.coach);
      const p4 = await mk(s.coach, s.ann);
      await h.asSuper();
      const g4 = p4.rows[0].id;
      await h.as(s.ann);
      const no = await tryQ(db, `update public.client_goals set status = 'declined' where id = $1`, [g4]);
      const move = await tryQ(db, `update public.client_goals set athlete_id = $2 where id = $1`, [g4, s.bob]);
      await h.asSuper();
      h.check("the client can decline a goal their coach suggested", !no.error && (await goal(h, g4)).status === "declined", JSON.stringify(no));
      h.check("a goal can never be moved to another client", (await h.one(`select athlete_id from public.client_goals where id = $1`, [g4])).athlete_id === s.ann, JSON.stringify(move));

      // ---- a coach cannot get around the rule
      await h.as(s.coach);
      const p6 = await mk(s.coach, s.ann);
      await h.asSuper();
      const g6 = p6.rows[0].id;
      await h.as(s.coach);
      await tryQ(db, `update public.client_goals set created_by = athlete_id where id = $1`, [g6]);
      const viaAuthor = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [g6]);
      await h.asSuper();
      const c6 = await goal(h, g6);
      h.check("a coach cannot make the client the author and then confirm: authorship stays with the coach and the confirm is refused", /Only the client can confirm/.test(viaAuthor.error ?? "") && c6.created_by === s.coach && c6.status === "proposed", JSON.stringify({ viaAuthor, c6 }));
      await h.as(s.ann);
      await tryQ(db, `update public.client_goals set status = 'declined' where id = $1`, [g6]);
      await h.as(s.coach);
      const afterDecline = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [g6]);
      await h.asSuper();
      h.check("a coach cannot confirm a goal after the client declined it", /Only the client can confirm/.test(afterDecline.error ?? "") && (await goal(h, g6)).status === "declined", JSON.stringify(afterDecline));
      await h.as(s.coach);
      const p7 = await mk(s.coach, s.ann);
      await h.asSuper();
      const g7 = p7.rows[0].id;
      await h.as(s.coach);
      await tryQ(db, `update public.client_goals set confirmed_by = athlete_id, confirmed_at = now() where id = $1`, [g7]);
      await h.asSuper();
      const c7 = await goal(h, g7);
      h.check("a coach cannot write who confirmed a goal or when, even without changing its status", c7.confirmed_by === null && c7.status === "proposed", JSON.stringify(c7));
      await h.as(s.coach2);
      const coach2 = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [g7]);
      await h.asSuper();
      h.check("another coach of the group cannot confirm a goal a coach suggested either", /Only the client can confirm/.test(coach2.error ?? "") && (await goal(h, g7)).status === "proposed", JSON.stringify(coach2));

      // ---- a coach changing what the client agreed to reopens it
      await h.as(s.coach);
      const p8 = await mk(s.coach, s.ann);
      await h.asSuper();
      const g8 = p8.rows[0].id;
      await h.as(s.ann);
      await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [g8]);
      await h.as(s.coach);
      const tagOnly = await tryQ(db, `update public.client_goals set priority_note = 'rear delts', weight_class_flag = true where id = $1`, [g8]);
      await h.asSuper();
      const c8a = await goal(h, g8);
      h.check("a coach's note or flags on a confirmed goal leave it confirmed by the client", !tagOnly.error && c8a.status === "confirmed" && c8a.confirmed_by === s.ann, JSON.stringify({ tagOnly, c8a }));
      await h.as(s.coach);
      const dateChange = await tryQ(db, `update public.client_goals set target_date = '2028-01-01' where id = $1`, [g8]);
      await h.asSuper();
      const c8b = await goal(h, g8);
      h.check("a coach changing the date or type of a confirmed goal sends it back to the client: proposed again, authored by the coach, confirmation cleared", !dateChange.error && c8b.status === "proposed" && c8b.created_by === s.coach && c8b.confirmed_by === null, JSON.stringify({ dateChange, c8b }));
      await h.as(s.coach);
      const p9 = await mk(s.coach, s.ann);
      await h.asSuper();
      const g9 = p9.rows[0].id;
      await h.as(s.ann);
      await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [g9]);
      await h.as(s.coach);
      await tryQ(db, `update public.client_goals set status = 'declined' where id = $1`, [g9]);
      await h.asSuper();
      const c9 = await goal(h, g9);
      h.check("when a goal stops being confirmed, who confirmed it and when are cleared", c9.status === "declined" && c9.confirmed_by === null, JSON.stringify(c9));

      // ---- what already worked still works
      await h.as(s.ann);
      const p5 = await mk(s.ann, s.ann);
      await h.asSuper();
      const g5 = p5.rows[0].id;
      await h.as(s.coach);
      const old = await tryQ(db, `update public.client_goals set status = 'confirmed', confirmed_at = now(), confirmed_by = $2 where id = $1`, [g5, s.coach]);
      const tag = await tryQ(db, `update public.client_goals set priority_note = 'main lift: squat' where id = $1`, [g5]);
      await h.asSuper();
      h.check("a coach still confirms a client's own proposal, and still edits a confirmed goal", !old.error && !tag.error && (await goal(h, g5)).status === "confirmed", JSON.stringify({ old, tag }));
      const notified = await notices(h, s.ann, "goal_answered");
      h.check("the client is told when their coach confirms their goal", notified.some((n) => /confirmed/.test(n.body)), JSON.stringify(notified));
    },
  },
};
