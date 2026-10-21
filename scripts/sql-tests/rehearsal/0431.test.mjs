// 0431 A coach's own passages for Read during rest: the coach reads and writes only his own; a person in a group he coaches can read them; nobody else can; the limits hold.
const T = "public.coach_read_passages";
export default {
  name: "0431 a coach's own passages join his clients' Read cycle",
  migrations: ["0431"],
  phases: {
    async "0431"({ db, h }) {
      const coach = await h.user("RP Coach");
      const otherCoach = await h.user("RP Other Coach");
      const ann = await h.user("RP Ann");
      const stranger = await h.user("RP Stranger");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "RP group");
      await h.member(g, ann);
      const otherOrg = await h.org(otherCoach);
      const og = await h.group(otherOrg, otherCoach, "team", "RP other group");
      await h.member(og, stranger);

      const add = (who, ref, text) => db.query(`insert into ${T} (coach_id, reference, text) values ($1, $2, $3)`, [who, ref, text]);

      await h.as(coach);
      await add(coach, "Philippians 4:13", "I can do all things through Christ which strengtheneth me.");
      h.check("a coach adds his own passage and reads it", (await h.rows(`select reference from ${T}`)).length === 1);
      await h.expectError("he cannot add one for another coach", () => add(otherCoach, "Psalm 1:1", "Blessed is the man."), /row-level security/i);
      await h.expectError("a reference over 60 characters is refused", () => add(coach, "x".repeat(61), "text"), /coach_read_passages_reference_ok/);
      await h.expectError("a text over 600 characters is refused", () => add(coach, "Psalm 119", "y".repeat(601)), /coach_read_passages_text_ok/);
      await h.expectError("an empty text is refused", () => add(coach, "Psalm 2:1", "   "), /coach_read_passages_text_ok/);
      await db.query(`update ${T} set text = 'I can do all things through Christ which strengtheneth me. (Phil 4:13)' where coach_id = $1`, [coach]);
      h.check("he changes his own", /Phil 4:13/.test((await h.one(`select text from ${T} where coach_id = $1`, [coach])).text));

      await h.as(otherCoach);
      await add(otherCoach, "Isaiah 40:31", "But they that wait upon the LORD shall renew their strength.");
      h.check("another coach sees only his own", (await h.rows(`select coach_id from ${T}`)).every((r) => r.coach_id === otherCoach));
      const changed = await db.query(`update ${T} set text = 'changed' where coach_id = $1`, [coach]);
      const removed = await db.query(`delete from ${T} where coach_id = $1`, [coach]);
      h.check("...and cannot change or remove someone else's", changed.rowCount === 0 && removed.rowCount === 0);

      await h.as(ann);
      const annSees = await h.rows(`select coach_id, reference from ${T}`);
      h.check("a client of the coach reads his passages, and not another coach's", annSees.length === 1 && annSees[0].coach_id === coach, JSON.stringify(annSees));
      await h.expectError("a client cannot add one", () => add(ann, "Psalm 23:1", "The LORD is my shepherd."), /row-level security/i);
      h.check("...nor change or remove his", (await db.query(`delete from ${T}`)).rowCount === 0);

      await h.as(stranger);
      h.check("someone who is not in a group he coaches sees none of his", (await h.rows(`select coach_id from ${T} where coach_id = $1`, [coach])).length === 0);

      await h.as(coach);
      h.check("he removes his own", (await db.query(`delete from ${T} where coach_id = $1`, [coach])).rowCount === 1);

      await h.asSuper();
      const anon = await h.one(`select has_table_privilege('anon', '${T}', 'select') as s, has_table_privilege('authenticated', '${T}', 'truncate') as t`);
      h.check("signed-out visitors have no access, and nobody signed in can empty the table", anon.s === false && anon.t === false, JSON.stringify(anon));
    },
  },
};
