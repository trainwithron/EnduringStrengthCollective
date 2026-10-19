// 0420: ownership of an organization cannot be handed to someone who has never signed in (last_sign_in_at is empty). A confirmed invitation link is not enough. Everything else about the transfer is as before.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0420 Ownership only to someone who has accepted",
  migrations: ["0420"],
  phases: {
    async "0420"({ db, h }) {
      const owner = await h.user("OW Owner");
      const admin = await h.user("OW Platform Admin");
      const accepted = await h.user("OW Accepted");
      const pending = await h.user("OW Pending Invitee");
      const confirmed = await h.user("OW Confirmed Not Signed In");
      const plain = await h.user("OW No Marker");
      const signedIn = await h.user("OW Signed In Unconfirmed");
      const leaving = await h.user("OW Leaving");
      const outsider = await h.user("OW Outsider");
      const platformAdmin = await h.platformAdmin("OW Real Platform Admin");
      const org = await h.org(owner, "OW Gym");
      for (const p of [accepted, pending, confirmed, plain, leaving, signedIn]) await h.orgMember(org, p, "coach");
      await h.asSuper();
      await db.query(`update auth.users set last_sign_in_at = now(), email_confirmed_at = now() where id = $1`, [accepted]);
      // the owner has signed in (an owner always has)
      await db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [owner]);
      // an invitation nobody has accepted: our marker, never confirmed, never signed in
      await db.query(`update auth.users set invited_at = now() where id = $1`, [pending]);
      // confirmed (the link was opened, maybe by an email scanner) but nobody has signed in: NOT enough for ownership
      await db.query(`update auth.users set invited_at = now(), email_confirmed_at = now() where id = $1`, [confirmed]);
      // signed in (so a person has really used the account) though the link was never marked confirmed: that is enough
      await db.query(`update auth.users set invited_at = now(), last_sign_in_at = now() where id = $1`, [signedIn]);
      // an ordinary account with no invitation marker that has never signed in: also not enough (the rule is a real sign-in)
      await db.query(`update public.organization_memberships set departing_since = now() where organization_id = $1 and profile_id = $2`, [org, leaving]);
      await db.query(`update auth.users set last_sign_in_at = now(), invited_at = now() where id = $1`, [leaving]);

      const transfer = async (who, target, as = "user") => {
        if (as === "service") await h.asService();
        else await h.as(who);
        const r = await tryQ(db, `select public.transfer_organization_ownership($1, $2)`, [org, target]);
        await h.asSuper();
        return r;
      };
      const ownerNow = async () => (await db.query(`select owner_id from public.organizations where id = $1`, [org])).rows[0].owner_id;
      const roleOf = async (p) => (await db.query(`select role from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, p])).rows[0]?.role;

      // ---- someone who has not accepted is refused, in plain words, and nothing changes
      let r = await transfer(owner, pending);
      h.check("the owner cannot hand ownership to someone who has not accepted their invitation", !!r.error && /has not accepted their invitation yet\. Ask them to sign in first\./.test(r.error), JSON.stringify(r));
      h.check("and nothing changed", (await ownerNow()) === owner && (await roleOf(owner)) === "owner" && (await roleOf(pending)) === "coach");
      r = await transfer(platformAdmin, pending);
      h.check("nor can a platform admin", !!r.error && /has not accepted/.test(r.error), JSON.stringify(r));
      h.check("and nothing changed", (await ownerNow()) === owner);

      // ---- the server key is still allowed through
      r = await transfer(null, pending, "service");
      h.check("the server key (how support acts) is not held to it" + (r.error ? ": " + r.error : ""), !r.error);
      h.check("so the pending invitee became owner that way, and the old owner is an admin", (await ownerNow()) === pending && (await roleOf(pending)) === "owner" && (await roleOf(owner)) === "admin");
      // put it back for the rest
      r = await transfer(null, owner, "service");
      h.check("and the server key can put it back", !r.error && (await ownerNow()) === owner && (await roleOf(owner)) === "owner" && (await roleOf(pending)) === "admin");
      await db.query(`update public.organization_memberships set role = 'coach' where organization_id = $1 and profile_id = $2`, [org, pending]);

      // ---- someone who has accepted passes, and everything else is as before
      r = await transfer(owner, accepted);
      h.check("the owner can hand ownership to a coach who has accepted" + (r.error ? ": " + r.error : ""), !r.error);
      h.check("the new owner is the owner, the old owner is an admin", (await ownerNow()) === accepted && (await roleOf(accepted)) === "owner" && (await roleOf(owner)) === "admin");
      r = await transfer(accepted, owner);
      h.check("it can go back, to someone who is an admin and has signed in", !r.error && (await ownerNow()) === owner && (await roleOf(accepted)) === "admin");

      // confirmed but never signed in is refused (an email link scanner can confirm a link with no person acting), and so is an account with no invitation marker that has never signed in
      r = await transfer(owner, confirmed);
      h.check("someone who confirmed their invitation link but has never signed in is refused", !!r.error && /has not accepted their invitation yet\. Ask them to sign in first\./.test(r.error), JSON.stringify(r));
      r = await transfer(platformAdmin, confirmed);
      h.check("and so for a platform admin", !!r.error && /has not accepted/.test(r.error), JSON.stringify(r));
      r = await transfer(owner, plain);
      h.check("an account that has never signed in is refused even with no invitation marker", !!r.error && /has not accepted/.test(r.error), JSON.stringify(r));
      h.check("nothing changed", (await ownerNow()) === owner && (await roleOf(confirmed)) === "coach" && (await roleOf(plain)) === "coach");

      r = await transfer(owner, signedIn);
      h.check("someone who has signed in is enough, even if the link was never marked confirmed" + (r.error ? ": " + r.error : ""), !r.error && (await ownerNow()) === signedIn);
      r = await transfer(signedIn, owner);
      h.check("(and back)", !r.error && (await ownerNow()) === owner);

      // ---- the same refusal at the tables: the owner cannot get round it by writing the rows directly
      await h.as(owner);
      r = await tryQ(db, `update public.organizations set owner_id = $1 where id = $2 returning id`, [confirmed, org]);
      await h.asSuper();
      h.check("writing the organization's owner directly to someone who has not accepted is refused", !!r.error && /has not accepted their invitation yet/.test(r.error), JSON.stringify(r));
      await h.as(owner);
      r = await tryQ(db, `update public.organization_memberships set role = 'owner' where organization_id = $1 and profile_id = $2 returning id`, [org, pending]);
      await h.asSuper();
      h.check("so is making their membership the owner's directly", !!r.error && /handed over with Transfer ownership/.test(r.error), JSON.stringify(r));
      await h.as(owner);
      r = await tryQ(db, `update public.organization_memberships set role = 'owner' where organization_id = $1 and profile_id = $2 returning id`, [org, accepted]);
      await h.asSuper();
      h.check("and so is making anyone else's membership the owner's by changing the role, even someone who has accepted", !!r.error && /handed over with Transfer ownership/.test(r.error), JSON.stringify(r));
      h.check("nothing changed: still the same owner, and neither of them is an owner", (await ownerNow()) === owner && (await roleOf(pending)) === "coach" && (await roleOf(accepted)) !== "owner");
      await h.as(owner);
      r = await tryQ(db, `update public.organization_memberships set role = 'admin' where organization_id = $1 and profile_id = $2 returning id`, [org, accepted]);
      await h.asSuper();
      h.check("changing a role to admin directly is untouched" + (r.error ? ": " + r.error : ""), !r.error);
      await db.query(`update public.organization_memberships set role = 'coach' where organization_id = $1 and profile_id = $2`, [org, accepted]);
      // the owner row itself can still be rewritten as owner (nothing changes), and the transfer function still passes the guard it now has to get through
      r = await transfer(owner, accepted);
      h.check("the transfer function itself still passes both guards for an accepted coach" + (r.error ? ": " + r.error : ""), !r.error && (await roleOf(accepted)) === "owner");
      r = await transfer(accepted, owner);
      h.check("(and back)", !r.error && (await ownerNow()) === owner);

      // ---- the older rules still hold
      r = await transfer(owner, leaving);
      h.check("someone who is leaving still cannot be made owner, with their own message", !!r.error && /is leaving this organization/.test(r.error), JSON.stringify(r));
      r = await transfer(owner, outsider);
      h.check("someone who is not a member still cannot", !!r.error && /already be a member/.test(r.error), JSON.stringify(r));
      r = await transfer(owner, owner);
      h.check("nor the person who already owns it", !!r.error && /already owns/.test(r.error), JSON.stringify(r));
      r = await transfer(accepted, accepted);
      h.check("a coach who is not the owner cannot transfer anything", !!r.error && /Only the current owner or a platform admin/.test(r.error), JSON.stringify(r));
      await h.as(null);
      r = await tryQ(db, `select public.transfer_organization_ownership($1, $2)`, [org, accepted]);
      await h.asSuper();
      h.check("a signed-out visitor cannot", !!r.error);
      h.check("after all of that the owner is still the owner", (await ownerNow()) === owner && (await roleOf(owner)) === "owner");
    },
  },
};
