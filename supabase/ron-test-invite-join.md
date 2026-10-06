# Invite-join test (run after step 08, before step 09)

Purpose: prove joining a group through an invite link works with the new database check, before step 09 (0238) closes the old way of joining. If the deployed site were older than commit 0019772, step 09 would break every invite link; this test is how you know it is safe. About 10 minutes. This creates a real test account; use an email alias such as `yourname+invitetest1@gmail.com`.

You need: a **team** group where you are the coach (the Test Sandbox group is fine), and a private/incognito browser window.

## Steps

1. Signed in as the coach, open the group's Clients page and press **Invite athlete**. Copy the link (it looks like `/invite/<code>`).
2. In a **private window** (not signed in), open the link.
   - Expected: the page shows the group name and a sign-up form. If it says the link is invalid or expired, stop and tell Spot.
3. Sign up with the test email alias and a password. Follow any "confirm your email" step.
   - Expected: you end up inside the group (the client Home). No "couldn't join" error.
4. Back as coach: the new person appears in the group's client list.
5. Reuse check: in the private window, sign out, open the same link again while signed in as that same new person.
   - Expected: it takes you into the group again with no error and no duplicate.
6. One-on-one limit (optional, only if you have a 1-on-1 group with no client yet): make an invite for it, join with one account, then try a second new account with the same link.
   - Expected: the second one is told the link has already been used.

## Read-only check in the Supabase SQL editor (changes nothing)

```sql
select gm.role, p.full_name, gm.joined_at
from public.group_memberships gm
join public.profiles p on p.id = gm.profile_id
where gm.group_id = '<groupId>'
order by gm.joined_at desc
limit 5;
```

The newest row is your test account with role `athlete`, and there is exactly one row for it.

## Clean-up

Remove the test account from the group on the Clients page (and delete the account if you like). Nothing else was changed.

## Result

- All as expected: tell Spot "invite-join test passed", confirm in Vercel that the live deployment is commit 0019772 or later, then run step 09.
- Anything different (invalid link, error after sign-up, the person not in the group): **do not run step 09.** Send Spot what you saw. Steps 08 and earlier are safe to leave in place; joining keeps working the old way until step 09.

## After step 09

Repeat steps 1-4 once with a fresh link. Expected: joining still works. If it fails, tell Spot immediately; the fix is a one-line policy restore that Spot will give you.
