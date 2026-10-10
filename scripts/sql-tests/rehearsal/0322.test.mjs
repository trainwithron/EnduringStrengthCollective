// 0322: deleting a client clears everything that still points at them, from the database's own list. A client who created an invite can be removed; a person who owns an organization or a group
// is refused with a plain message and NOTHING is changed; the functions are server-only; and every "not null" link to a profile is decided (the guard that fails when a new migration adds one).
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0322 deleting a client clears what points at them",
  migrations: ["0322"],
  phases: {
    async "0322"({ db, h }) {
      const coach = await h.user("DR Coach");
      const ann = await h.user("DR Ann");
      const owner = await h.user("DR Owner");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "DR group");
      await h.member(group, ann);

      await h.asSuper();
      // The guard: no "not null" link to a profile is undecided.
      const unhandled = await h.rows("select * from public.profile_reference_unhandled()");
      h.check("every 'not null' link to a profile is decided (delete or refuse); a new one fails this check: " + JSON.stringify(unhandled), unhandled.length === 0);

      // A client who created an invite can now be deleted.
      await db.query("insert into public.group_invites (group_id, created_by) values ($1, $2)", [group, ann]).catch(async () => {
        await db.query("insert into public.group_invites (group_id, created_by, code) values ($1, $2, 'rehearsal-code')", [group, ann]);
      });
      const before = await tryQ(db, "delete from public.profiles where id = $1", [ann]);
      h.check("before clearing, the invite they created blocks deleting them (this was the bug)", !!before.error, JSON.stringify(before));
      const cleared = await tryQ(db, "select public.detach_profile_references($1)", [ann]);
      h.check("clearing succeeds for a client who created an invite", !cleared.error, JSON.stringify(cleared));
      const after = await tryQ(db, "delete from public.profiles where id = $1 returning id", [ann]);
      h.check("and then the person can be deleted", !after.error && after.rows.length === 1, JSON.stringify(after));

      // An organization owner / group creator is refused, and nothing is changed.
      const refused = await tryQ(db, "select public.detach_profile_references($1)", [coach]);
      h.check("someone who owns an organization or created a group is refused with a plain 'cannot_delete' message", !!refused.error && /cannot_delete/.test(refused.error), JSON.stringify(refused));
      const stillThere = await h.one("select count(*)::int as n from public.groups where created_by = $1", [coach]);
      h.check("and nothing of theirs was changed", stillThere.n >= 1, JSON.stringify(stillThere));

      // Server only.
      for (const [who, label] of [[owner, "a signed-in user"], [null, "a signed-out visitor"]]) {
        await h.as(who);
        const r = await tryQ(db, "select public.detach_profile_references($1)", [owner]);
        h.check(`${label} cannot run the clearing function`, !!r.error, JSON.stringify(r));
      }
      await h.asService();
      const svc = await tryQ(db, "select public.detach_profile_references($1)", [owner]);
      h.check("the server (service role) can", !svc.error, JSON.stringify(svc));
    },
  },
};
