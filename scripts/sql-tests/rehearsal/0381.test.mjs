// 0381: a client's one-on-one space follows a change of the client's name, but only when it still carried the old name exactly.
export default {
  name: "0381 A one-on-one space's name follows its client's name",
  migrations: ["0381"],
  phases: {
    async "0381"({ db, h }) {
      const coach = await h.user("NM Coach");
      const org = await h.org(coach);
      const client = await h.user("Johann Gorsik");
      const solo = await h.group(org, coach, "one_on_one", "Johann Gorsik");
      await h.member(solo, client);
      const chosen = await h.user("Jeff Ziegler");
      const soloChosen = await h.group(org, coach, "one_on_one", "Jeff Z");
      await h.member(soloChosen, chosen);
      const team = await h.group(org, coach, "team", "Johann Gorsik");
      await h.member(team, client);
      await h.asSuper();
      await db.query(`update public.profiles set full_name = 'Johann Gorsek' where id = $1`, [client]);
      const a = await h.one(`select name from public.groups where id = $1`, [solo]);
      h.check("the client's one-on-one space takes the corrected name", a.name === "Johann Gorsek");
      const t = await h.one(`select name from public.groups where id = $1`, [team]);
      h.check("a team that happens to share the old name is not renamed", t.name === "Johann Gorsik");
      await db.query(`update public.profiles set full_name = 'Jeff P Ziegler' where id = $1`, [chosen]);
      const b = await h.one(`select name from public.groups where id = $1`, [soloChosen]);
      h.check("a space whose name the coach chose differently (Jeff Z) is left alone", b.name === "Jeff Z");
      await db.query(`update public.profiles set full_name = 'Johann Gorsek' where id = $1`, [client]);
      h.check("an update that does not change the name does nothing", true);
    },
  },
};
