// 0334: a client chooses whether their first name shows on their shared workout pictures. On for everyone by default (including under 18, Ron's decision); only the client
// can change their own choice.
export default {
  name: "0334 show my first name on shared workout pictures",
  migrations: ["0334"],
  phases: {
    async "0334"({ h }) {
      const ann = await h.user("SN Ann");
      const bob = await h.user("SN Bob");
      await h.asSuper();
      const def = await h.one("select show_name_on_share as v from public.profiles where id = $1", [ann]);
      h.check("the name shows by default for an existing client", def.v === true);
      await h.as(ann);
      const mine = await h.rows("update public.profiles set show_name_on_share = false where id = $1 returning show_name_on_share as v", [ann]);
      h.check("a client can switch their own name off", mine.length === 1 && mine[0].v === false);
      await h.as(bob);
      const theirs = await h.rows("update public.profiles set show_name_on_share = true where id = $1 returning id", [ann]);
      h.check("another client cannot change it", theirs.length === 0);
      await h.asSuper();
      const kept = await h.one("select show_name_on_share as v from public.profiles where id = $1", [ann]);
      h.check("the choice stays as the client set it", kept.v === false);
      const bobDefault = await h.one("select show_name_on_share as v from public.profiles where id = $1", [bob]);
      h.check("and nobody else's changed", bobDefault.v === true);
    },
  },
};
