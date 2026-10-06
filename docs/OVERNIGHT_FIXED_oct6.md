# Overnight, Oct 5 to 6: what was fixed, and what needs Ron

Nothing here is pushed, deployed or applied. The Oct 5 evening deploy (head 981ee51) is what is live. Every branch keeps tsc, tests and the build green.

## SHIP ORDER (plain)

1. **Hotfix: Delete client** (branch `hotfix-delete-client`, one commit, e49c308). Do this first and alone. Until it ships, do not use Delete client on a real client (it deletes the one-on-one space and, with it, the logged workouts and notes the screen says are kept).
   *After it ships, try:* nothing visible; just don't test it on a real client (use a throwaway client if you want to see it).
2. **Safe batch** (branch `overnight-safe`): wording, labels, missing exits, spacing, phone fixes, sign-in email handling, job-monitoring fix. No database changes, nothing touching money.
   *After it ships, try (phone):* Home, Add a client (panel opens on Add directly); Spotlight (top button), Clients, tap **Profile** on a client; on a client's profile tap Schedule session (the client is already picked); More list shows Settings, and Settings has your own tabs at the bottom; sign in with a trailing space after your email (it still works).
3. **Care batch, code** (branch `overnight-care`, on top of safe): the calendar (every client across your groups, times on your clock, controls on every booking), client-to-coach pushes, clock-change days, the public forms moved to server routes, and the other items listed under "Care batch" below. Deploy only on Ron's word.
   *After it ships, try (phone):* Calendar tab, pick a one-on-one client, month Prev/Next, tap a day, **Assign** on a time (even for a client at 0 sessions), Mark attended on a past one, and cancel one week of a weekly schedule.
4. **Database steps** (paste files `supabase\apply\apply-step12` to `step16`, each with a precheck and an undo file). Ron pastes them himself, in this order, after the review of the paste files is done:
   - step 12 (0270) a coach can only add their own clients to a group
   - step 14 (0273) guards on groups and organizations
   - step 16 (0275) a client's cancelled or moved week of a weekly schedule stays skipped
   - step 13 (0271) database functions are signed-in and server only. After it, paste `supabase\apply\check-step13-probe.sql` (it rolls itself back): it must show anon_can_run = false. Note for later: after any future CREATE EXTENSION run in the SQL editor, grant execute on its functions to authenticated and service_role.
   - step 15 (0274) a completed workout is locked against added or deleted sets and against being reopened
   - step 18 (0276) a new message gives the recipient an in-app notice (one line per sender while unread, no message text); undo included
   - (reviewed read-only against the live database by the Assistant session; steps 13 and 15 were revised after that review and are being re-checked)
   - then deploy the care batch (code)
   - **step 17 (0272) only AFTER the care batch is deployed** (it closes the two public forms' database functions to the browser; the care batch moves those forms to server routes)
   Steps 12 to 16 are safe with the code that is live today. After each one, open the live site as a coach and a client and check Home, the calendar and one booking.

## How the branches fit together

- `hotfix-delete-client`: one commit on master. Ship first.
- `overnight-safe`: SAFE fixes only. Starts from master.
- `overnight-care`: starts from `overnight-safe`. Do not merge it before the safe batch.

## URGENT: Delete client (live on master)

The Delete client button shipped in the Oct 5 deploy deleted the client's one-on-one space along with the client. Deleting that space also deletes their logged workouts, sessions and your notes about them, even when the screen says history is kept. **Do not use Delete client on a real client until the hotfix is deployed.**

## Safe batch (SAFE), on `overnight-safe`

| Fix | Commit |
|---|---|
| Phone: a **Profile** button on every client row in the Spotlight Clients list, and "Open profile" in the Roster popup (a one-on-one client lives in their own group, so there was no way to open their profile from the phone) | 77753aa |
| "Schedule session" on a client's profile now opens the phone calendar with that client already picked | 77753aa |
| The **Sessions left** (+/-) box and the **Assign sessions** box on a profile no longer go stale after the other one changes the balance | 77753aa |
| A client who has not signed in yet is no longer flagged "gone quiet" (profile banner and phone Roster) | 77753aa |
| **Add client** panel: opens on Add directly, link mode needs the client's name (no more spaces called "New 1-on-1 client"), 44px fields at 16px text (no iOS zoom), wraps under the title, a failed coach-membership step no longer leaves an empty space behind | 9f44009 |
| Phone Home: **Add a client** opens the Add panel directly; the duplicate "All clients" button is now just "Clients" | 9f44009 |
| Phone **More** list: adds Settings, Macro Calculator, Booking Page, Group Sessions, Quick Tips; hides Team Feed for one-on-one groups; "Client-Facing Mode" is now "Phone layout" | b88b225 |
| Tab bar: "Roster" is now **Clients**, Messages uses a mail icon | b88b225 |
| Coach **Settings** has an entry on phone and desktop, and uses the coach's own tabs and Spotlight button | b88b225 |
| Copy: a **session**, not a "credit", in the picker, billing success, the expiry push and the late-move banner; the wording lint also covers billing, More and the expiry cron; a coach no longer sees My goal and Share my progress; the support page no longer names Ron; deploy checklist brought up to date | 544ac7b |
| **Job monitoring** can now notice a job that is never called (fixed start date; a weekly job gets its whole week first); tests | 9d92f42 |
| Sign-in, forgot-password and invite join trim and lowercase the email (a trailing space from a phone no longer reads as a wrong password), friendly sign-up and reset errors; the installed app opened signed out goes to sign-in instead of the sales page | 2fe15cb |

## Care batch (CARE), on `overnight-care`

| Fix | Commit |
|---|---|
| **Delete client** no longer deletes the space when history is kept; screen copy lists what really goes | 5d54cb4 (also e49c308 on the hotfix branch) |
| **Coach cancel**: role-aware wording, shows errors, and a session in a weekly schedule is taken off the schedule so the nightly top-up does not book it back | 5d54cb4 |
| **Coach day page** (the phone scheduling screen): Assign always shows (a client at 0 or owed can still be scheduled); every booking has Mark attended / Cancel / No-show even at a time that is not an open slot or when no hours are set (Other sessions today); a slot that overlaps another says Busy; times and the hour grid are on the coach's clock; day end is the next local midnight; Back keeps the client; header says Owed N | 274676a |
| **Phone calendar**: every client across the coach's groups, booked in their own group; month Prev/Next; the client's sessions on their days; Owed wording; 44px picker | 5bee05a |
| **Desktop calendar**: client list, drag-to-book, balance +/- and Open work across groups; booking times and day keys on the coach's clock | 9d4fa2f |
| **A client sees their own sessions** even when the coach has no hours set, and in the coach's time zone | 9d4fa2f |
| **Clock-change days** are no longer an hour off (tests for NY, LA, Phoenix); **52-week series** routes get 60 seconds; the **daily conflict check** uses the coach's local day, skips a coach with no hours, and sends one summary per coach | 72c5ff0 |
| **Google Health sync cron** is reachable (it was redirected to /login and never ran) | 1a92395 |
| **Pushes from a client to their coach now arrive** (the send route checks the pair share a group or organization and sends with the server's access; before, every client-to-coach push, message, video and check-in sent nothing) | 1d6cd74 |
| **Public forms** (discovery-call page, gym QR form) post to rate-limited server routes that validate first (also needed before step 17) | acfb547 area (see git log) |
| **Database migrations 0270 to 0275** with real-role rehearsals and paste steps 12 to 17 | see git log |

## Needs Ron's decision (one line each, with my recommendation)

- **Ship the Delete client hotfix first**: yes, before anything else.
- **Home "Dashboard" vs "Home"**: two pages with similar jobs; recommended: rename the per-group page "Activity", no merge.
- **Session Types vs Booking Page "Sessions people can book"**: two editors for one list; recommended: keep both, link them.
- **Quick Tips, 1RM calculator, Video check-ins** have no coach entry on any device; recommended: leave as they are.
- **Which time zone is the default when a coach has not set one** (today New York): recommended: ask once on first Calendar visit and save the browser's zone.
- **Hide Kiosk, Display Mode, Hall of Fame, Challenges for one-on-one groups**: recommended: hide Kiosk and Display Mode only.
- **Public booking page** stays closed until an email sender is set; recommended: leave closed.
- **Clients under 18**: the intake blocks under 13 only; recommended: decide the adults-only rule before any outside coach joins.

## Queued, not done yet (so nothing is lost)

1. **Messaging**: no in-app notice for a new message (needs a migration: a trigger), a Message button on the client profile, "Message your coach" on the client Home.
2. **A hold should clear when a client gets sessions again**, Mark attended should fire the low-balance alerts, and a past session still "confirmed" needs a "resolve past sessions" prompt (money; needs your call).
3. **Silent failed saves** (settings toggles that say Saved but did not save), raw error text shown to users, optimistic deletes with no rollback, the shared friendly-error helper.
4. **Day-one client path copy** (sign-up, claim, confirm-email, intake wording).
5. **iPhone layout** (dvh, safe areas, in-app browsers).
6. **Data and scale**: unbounded reads, long id lists in URLs, history import accuracy, GZCLP and training-max math, food matching.
7. **AI cost caps** and privacy text (beta notice); account export completeness; accessibility and page titles.
8. **Security items still open**: `/api/discovery-availability` should require a real coach and a rate limit; push subscribe host allowlist; intake `next` redirect check; cron secret comparison; column guards on other client-writable tables; org-wide leaks (push subscriptions, billing, support tickets).
9. Duplicates and dead code clean-up.
