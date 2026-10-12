// 0342: private lookups the row rules use can't be asked about other people by a signed-in account; the rules themselves keep working.
export default {
  name: "0342 private lookup functions answer only for the people they concern",
  migrations: ["0342"],
  phases: {
    async "0342"({ db, h }) {
      const coach = await h.user("AT Coach");
      const clientA = await h.user("AT Client A");
      const clientB = await h.user("AT Client B");
      const spy = await h.user("AT Spy");
      const spyCoach = await h.user("AT Spy Coach");
      const org = await h.org(coach);
      const spyOrg = await h.org(spyCoach);
      const g = await h.group(org, coach, "team", "AT team");
      const spyGroup = await h.group(spyOrg, spyCoach, "team", "AT spy team");
      await h.member(g, clientA);
      await h.member(g, clientB);
      await h.member(spyGroup, spy);

      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [g, clientA]);

      const q = (sql, params) => db.query(sql, params).then((r) => r.rows[0]);

      // a stranger cannot ask about other people
      await h.as(spy);
      h.check("share_org: a stranger asking about two other people gets no", (await q(`select public.training_partners_share_org($1, $2) as v`, [clientA, clientB])).v === false);
      h.check("is_training_client_of_group: a stranger asking about someone else's group gets no", (await q(`select public.is_training_client_of_group($1, $2) as v`, [g, clientA])).v === false);
      h.check("is_client_private_from_org: a stranger gets no", (await q(`select public.is_client_private_from_org($1, $2) as v`, [g, clientA])).v === false);
      h.check("is_wearable_subject_private_from_org: a stranger gets no", (await q(`select public.is_wearable_subject_private_from_org($1) as v`, [clientA])).v === false);
      await h.expectError("the coach-count function is closed to a signed-in user", () => db.query(`select public.coach_ai_multiplier($1)`, [coach]), /permission denied/i);
      await h.expectError("...and the client-step one", () => db.query(`select public.coach_client_steps($1)`, [coach]), /permission denied/i);

      // the people concerned still get the real answers
      await h.as(clientB);
      h.check("share_org: a person asking about themselves and someone in the same organization gets yes", (await q(`select public.training_partners_share_org($1, $2) as v`, [clientB, clientA])).v === true);
      h.check("is_training_client_of_group: a person asking about themselves gets yes", (await q(`select public.is_training_client_of_group($1) as v`, [g])).v === true);
      await h.as(clientA);
      h.check("is_client_private_from_org: the client sees their own setting", (await q(`select public.is_client_private_from_org($1, $2) as v`, [g, clientA])).v === true);
      await h.as(coach);
      h.check("is_client_private_from_org: their coach sees it", (await q(`select public.is_client_private_from_org($1, $2) as v`, [g, clientA])).v === true);
      h.check("is_training_client_of_group: their coach can ask about a client", (await q(`select public.is_training_client_of_group($1, $2) as v`, [g, clientB])).v === true);
      h.check("is_wearable_subject_private_from_org: the org owner (an admin of the client's organization) sees it", (await q(`select public.is_wearable_subject_private_from_org($1) as v`, [clientA])).v === true);

      // the server is unaffected
      await h.asSuper();
      h.check("the server still gets the real answers (share_org)", (await q(`select public.training_partners_share_org($1, $2) as v`, [clientA, clientB])).v === true);
      h.check("...and the coach count function", (await q(`select public.coach_ai_multiplier($1) as v`, [coach])).v !== null);

      // the training-partner rules (which call these) still work for the people concerned
      await db.query(`insert into public.training_partner_profiles (athlete_id, visible) values ($1, true)`, [clientA]);
      await h.as(clientB);
      const rows = await h.rows(`select athlete_id from public.training_partner_profiles where athlete_id = $1`, [clientA]);
      h.check("a visible partner in the same organization is still listed", rows.length === 1);
    },
  },
};
