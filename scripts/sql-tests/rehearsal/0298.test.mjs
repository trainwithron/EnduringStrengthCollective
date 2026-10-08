// 0298: Read during rest. The client's own switch is theirs alone, the coach's switch hides Read for all their clients, the coach's passage for a day reaches only that
// coach's clients, and the one function the client's screen asks answers only for a member of the group, about themselves.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0298 read during rest",
  migrations: ["0298"],
  phases: {
    async "0297"({ db, h }) {
      const t = await h.one(`select to_regclass('public.read_settings') as a, to_regclass('public.read_passage_overrides') as b`);
      h.check("baseline: no Read tables yet", t.a === null && t.b === null, JSON.stringify(t));
      const coach = await h.user("RD Coach");
      const ann = await h.user("RD Ann");
      const bob = await h.user("RD Bob");
      const coach2 = await h.user("RD Other Coach");
      const outsider = await h.user("RD Outsider");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "RD group");
      await h.member(group, ann);
      await h.member(group, bob);
      const org2 = await h.org(coach2);
      const group2 = await h.group(org2, coach2, "team", "RD other group");
      await h.asSuper();
      await db.query(`insert into public.coach_preferences (coach_id) values ($1) on conflict do nothing`, [coach]);
      globalThis.__rd = { coach, ann, bob, coach2, outsider, group, group2 };
    },

    async "0298"({ db, h }) {
      const { coach, ann, bob, coach2, outsider, group, group2 } = globalThis.__rd;
      const ask = async (uid, g, d = null) => {
        await h.as(uid);
        return tryQ(db, `select public.read_track_for_me($1, $2::date) as r`, [g, d]);
      };

      // ---- the coach's switch exists with a safe default ----
      await h.asSuper();
      const pref = await h.one(`select faith_track_default from public.coach_preferences where coach_id = $1`, [coach]);
      h.check("an existing coach's preference defaults to Read on", pref.faith_track_default === true, JSON.stringify(pref));

      // ---- on by default for a client with no row ----
      const first = await ask(ann, group, "2026-11-03");
      h.check("a client with no row has Read on, no coach passage, and has not seen the note", first.rows?.[0]?.r?.enabled === true && first.rows[0].r.override_reference === null && first.rows[0].r.note_seen === false, JSON.stringify(first));

      // ---- the client's own switch ----
      await h.as(ann);
      const mine = await tryQ(db, `insert into public.read_settings (athlete_id, faith_track) values ($1, false) returning faith_track`, [ann]);
      h.check("a client turns Read off for themselves", !mine.error && mine.rows?.[0]?.faith_track === false, JSON.stringify(mine));
      const off = await ask(ann, group);
      h.check("their own off wins: Read is not offered to them", off.rows?.[0]?.r?.enabled === false, JSON.stringify(off));
      const bobStill = await ask(bob, group);
      h.check("another client in the same group is unaffected", bobStill.rows?.[0]?.r?.enabled === true, JSON.stringify(bobStill));
      await h.as(bob);
      const bobSeesAnn = await tryQ(db, `select count(*)::int as n from public.read_settings`);
      h.check("a client cannot read anyone else's switch", bobSeesAnn.rows?.[0]?.n === 0, JSON.stringify(bobSeesAnn));
      const forge = await tryQ(db, `insert into public.read_settings (athlete_id, faith_track) values ($1, false)`, [ann]);
      h.check("a client cannot write someone else's switch", !!forge.error, JSON.stringify(forge));
      await h.as(coach);
      const coachSees = await tryQ(db, `select count(*)::int as n from public.read_settings`);
      h.check("a client's coach cannot read the client's switch either", coachSees.rows?.[0]?.n === 0, JSON.stringify(coachSees));
      await h.as(ann);
      const back = await tryQ(db, `update public.read_settings set faith_track = true, note_seen_at = now() where athlete_id = $1 returning faith_track`, [ann]);
      h.check("the client turns it back on and records that they saw the note", !back.error && back.rows?.[0]?.faith_track === true, JSON.stringify(back));
      const seen = await ask(ann, group);
      h.check("the function reports the note as seen", seen.rows?.[0]?.r?.enabled === true && seen.rows[0].r.note_seen === true, JSON.stringify(seen));

      // ---- the coach's switch hides Read for every client ----
      await h.as(coach);
      const coachOff = await tryQ(db, `update public.coach_preferences set faith_track_default = false where coach_id = $1 returning faith_track_default`, [coach]);
      h.check("a coach turns Read off for all their clients", !coachOff.error && coachOff.rows?.[0]?.faith_track_default === false, JSON.stringify(coachOff));
      const hidden = await ask(ann, group);
      const hiddenBob = await ask(bob, group);
      h.check("then Read is not offered to any of that coach's clients", hidden.rows?.[0]?.r?.enabled === false && hiddenBob.rows?.[0]?.r?.enabled === false);
      await h.as(ann);
      const clientReadsPrefs = await tryQ(db, `select count(*)::int as n from public.coach_preferences`);
      h.check("a client cannot read the coach's preferences directly", clientReadsPrefs.rows?.[0]?.n === 0, JSON.stringify(clientReadsPrefs));
      await h.as(coach);
      await tryQ(db, `update public.coach_preferences set faith_track_default = true where coach_id = $1`, [coach]);

      // ---- the coach's passage for a day ----
      await h.as(coach);
      const ov = await tryQ(db, `insert into public.read_passage_overrides (coach_id, override_date, reference) values ($1, '2026-11-03', 'Psalm 23:1-4') returning id`, [coach]);
      h.check("a coach chooses the passage for a day", !ov.error, JSON.stringify(ov));
      const dup = await tryQ(db, `insert into public.read_passage_overrides (coach_id, override_date, reference) values ($1, '2026-11-03', 'Psalm 46:1-3')`, [coach]);
      h.check("one passage per coach per day", /duplicate key|unique/i.test(dup.error ?? ""), JSON.stringify(dup));
      const tooShort = await tryQ(db, `insert into public.read_passage_overrides (coach_id, override_date, reference) values ($1, '2026-11-04', 'x')`, [coach]);
      const tooLong = await tryQ(db, `insert into public.read_passage_overrides (coach_id, override_date, reference) values ($1, '2026-11-05', repeat('x', 81))`, [coach]);
      h.check("a reference must be 3 to 80 characters", !!tooShort.error && !!tooLong.error);
      const clientGets = await ask(ann, group, "2026-11-03");
      h.check("the coach's clients get that passage for that day", clientGets.rows?.[0]?.r?.override_reference === "Psalm 23:1-4", JSON.stringify(clientGets));
      const otherDay = await ask(ann, group, "2026-11-04");
      h.check("and nothing on another day", otherDay.rows?.[0]?.r?.override_reference === null, JSON.stringify(otherDay));
      await h.as(coach2);
      const otherCoachOv = await tryQ(db, `insert into public.read_passage_overrides (coach_id, override_date, reference) values ($1, '2026-11-03', 'John 1:1-3')`, [coach2]);
      const otherCoachClient = await ask(coach2, group2, "2026-11-03");
      h.check("a coach in another organisation chooses their own, which their own group sees", !otherCoachOv.error, JSON.stringify(otherCoachOv));
      const ann2 = await ask(ann, group, "2026-11-03");
      h.check("and it never reaches this coach's clients", ann2.rows?.[0]?.r?.override_reference === "Psalm 23:1-4", JSON.stringify(ann2));
      void otherCoachClient;
      await h.as(ann);
      const clientDirect = await tryQ(db, `select count(*)::int as n from public.read_passage_overrides`);
      h.check("a client cannot read the coach's table directly", clientDirect.rows?.[0]?.n === 0, JSON.stringify(clientDirect));
      const clientWrite = await tryQ(db, `insert into public.read_passage_overrides (coach_id, override_date, reference) values ($1, '2026-12-01', 'Psalm 1:1-3')`, [coach]);
      h.check("a client cannot write one for the coach", !!clientWrite.error, JSON.stringify(clientWrite));
      await h.as(coach2);
      const coach2Sees = await tryQ(db, `select count(*)::int as n from public.read_passage_overrides where coach_id = $1`, [coach]);
      h.check("another coach cannot read this coach's choices", coach2Sees.rows?.[0]?.n === 0, JSON.stringify(coach2Sees));

      // ---- the function answers only for a member, about themselves ----
      const outsiderAsk = await ask(outsider, group);
      h.check("someone outside the group cannot ask", /not authorized/.test(outsiderAsk.error ?? ""), JSON.stringify(outsiderAsk));
      await h.as(null);
      const anon = await tryQ(db, `select public.read_track_for_me($1, null)`, [group]);
      h.check("a signed-out visitor cannot ask", !!anon.error, JSON.stringify(anon));
      const coachAsk = await ask(coach, group);
      h.check("a coach of the group can ask (about themselves)", coachAsk.rows?.[0]?.r?.enabled === true, JSON.stringify(coachAsk));
    },
  },
};
