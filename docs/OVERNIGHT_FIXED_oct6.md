# Overnight, Oct 5 to 6: what was fixed, and what needs Ron

Nothing here is pushed or deployed (the Oct 5 evening deploy was head 981ee51 on master). No migrations were applied. Each branch stays green (tsc, tests, build).

## How the work is split so it can ship in batches

- **`hotfix-delete-client`** (one commit on top of master): the Delete client fix. Ship this first, on its own. See the urgent note below.
- **`overnight-safe`**: only SAFE fixes (copy, labels, missing exits, spacing, accessibility, tests and docs, an isolated bug with a test). It starts from master plus this file, so it can be merged and deployed alone.
- **`overnight-care`**: starts from `overnight-safe` and adds the CARE fixes (anything touching credits or money, sign-in or row security, scheduling logic, time zones, data deletion, a migration, or a shared component used app-wide). Merge it only after the safe batch, and only on Ron's word.

## URGENT: Delete client (live on master)

**What was wrong:** the Delete client button shipped in the Oct 5 deploy deleted the client's one-on-one space along with the client. Deleting that space also deletes their logged workouts, sessions and your notes about them, even when the screen says "history is kept". **Do not use Delete client on a real client until the hotfix is deployed.** The fix is `hotfix-delete-client` (commit e49c308, tests added, tsc and build green).

## Batch 1 (SAFE) fixed, on `overnight-safe`

| Fix | Commit |
|---|---|
| Phone: a **Profile** button on every client row in the Spotlight Clients list, and "Open profile" in the Roster popup (a one-on-one client lives in their own group, so there was no way to open their profile from the phone) | 77753aa |
| "Schedule session" on a client's profile now opens the phone calendar with that client already picked | 77753aa |
| The **Sessions left** (+/-) box and the **Assign sessions** box on a profile no longer go stale after the other one changes the balance | 77753aa |
| A client who has not signed in yet is no longer flagged "gone quiet" (profile banner and phone Roster) | 77753aa |
| **Add client** panel: opens on Add directly, link mode needs the client's name (no more spaces called "New 1-on-1 client"), 44px fields at 16px text (no iOS zoom), wraps under the title instead of squeezing it, a failed coach-membership step no longer leaves an empty space behind | 9f44009 |
| Phone Home: **Add a client** opens the Add panel directly; the duplicate "All clients" button is now just "Clients" | 9f44009 |
| Phone **More** list: adds Settings, Macro Calculator, Booking Page, Group Sessions, Quick Tips; hides Team Feed for one-on-one groups; "Client-Facing Mode" is now "Phone layout" | b88b225 |
| Tab bar: "Roster" is now **Clients**, Messages uses a mail icon (it shared the Feed icon) | b88b225 |
| Coach **Settings** now has an entry on phone and desktop, and uses the coach's own tabs and Spotlight button instead of the client tab bar | b88b225 |
| Copy: a **session**, not a "credit", in the schedule picker, billing success, the expiry push and the late-move banner; "Sessions left" label; empty roster says "clients" | 544ac7b |
| The wording lint now also covers billing, the More page and the expiry cron | 544ac7b |
| More page: a coach no longer sees My goal and Share my progress (they open a no-access page for a coach) | 544ac7b |
| Support page no longer names Ron | 544ac7b |
| Deploy checklist brought up to date (0268 and 0269 are applied; deploy 6f0zm3hu2 is live) | 544ac7b |
| **Job monitoring** can now notice a job that is never called (fixed start date instead of the oldest row, which the busy jobs kept refreshing); a weekly job gets its whole week before it counts as never run; tests | 9d92f42 |

**What Ron should try after batch 1 (phone):** open the Spotlight (top button), Clients, tap **Profile** on a client; on a client's profile tap Schedule session and check that client is already picked; Home, Add a client, check the panel opens with Add directly and the buttons are easy to tap; More list shows Settings; open Settings and check the coach tabs are at the bottom.

## Batch 2 (CARE) fixed, on `overnight-care`

| Fix | Commit |
|---|---|
| **Delete client** no longer deletes the space when history is kept (the hotfix above) and its screen copy lists what really goes | 5d54cb4 |
| **Coach cancel**: role-aware wording (no balance wording), shows errors, and for a session in a weekly schedule it takes that week off the schedule so the nightly top-up does not book it back | 5d54cb4 |
| **Coach day page** (the phone scheduling screen): Assign always shows (a client at 0 or owed can still be scheduled); every booking has its Mark attended / Cancel / No-show even at a time that is not an open slot, or when no open hours are set (Other sessions today); a slot overlapping another session says Busy; times and the hour grid are on the coach's clock; day end is the next local midnight; Back keeps the client; header says Owed N | 274676a |
| **Phone calendar**: lists every client across the coach's groups (a one-on-one client lives in their own group), books them in their own group, month Prev/Next, and the client's sessions shown on their days (on the coach's clock); Owed wording; 44px picker | 5bee05a |
| **Desktop calendar**: the client list, drag-to-book, balance +/- and Open now work across the coach's groups; booking times and day keys on the coach's clock so a taken slot shows as taken and an evening session lands on the right day | 9d4fa2f |
| **A client sees their own sessions** even when the coach has no open hours set, and in the coach's time zone (both calendar pages) | 9d4fa2f |
| **Clock-change days** are no longer an hour off (the time-zone conversion looks the offset up twice and no longer depends on the machine's zone; tests for NY, LA and Phoenix) | 72c5ff0 |
| **52-week series** routes get 60 seconds to finish instead of stopping part way | 72c5ff0 |
| **Daily conflict check**: uses the coach's local day, skips a coach with no open hours at all, and sends one summary per coach instead of a push for every session | 72c5ff0 |
| **Google Health sync cron** is reachable (it was redirected to /login and never ran) | 1a92395 |

**What Ron should try after batch 2 (phone):** Calendar tab, pick a client who has their own space, check the month shows with Prev/Next, tap a day, tap Assign on a time (even for a client at 0), then Mark attended on a past one; put a client on a repeating weekly schedule from their profile and cancel one week; check the times read in your own time zone.

## Needs Ron's decision (one line each, with my recommendation)

(From the audit batches; each is a decision, not a bug.)

- **Delete client**: ship the hotfix (`hotfix-delete-client`) before anything else. Recommended: yes, today.
- **Home "Dashboard" vs "Home"**: two pages with similar jobs; recommended: rename the per-group page "Activity", no merge.
- **Session Types vs Booking Page "Sessions people can book"**: two editors for one list; recommended: keep both, link them.
- **Quick Tips, 1RM calculator, Video check-ins** have no coach entry on any device; recommended: leave as they are (feature bloat rule).
- **Which time zone is the default when a coach has not set one** (today New York): recommended: ask the coach once on first Calendar visit and save the browser's zone.
- **Hide Kiosk, Display Mode, Hall of Fame, Challenges for one-on-one groups**: recommended: hide Kiosk and Display Mode only.

## Queued, not done yet (so nothing is lost)

The audit batches found much more than one night allows. In rough order, still to do:

1. **Messaging**: client-to-coach push never arrives (needs a server-side send), no in-app notice for a new message, "Message your coach" on the client Home, a Message button on the client profile.
2. **Security (need migrations, paste files and prechecks)**: group membership insert rule (any coach can add any user to their group), anonymous discovery/gym-lead functions, function permission sweep, column guards on organizations and groups, push subscribe host allowlist, intake redirect check, cron secret comparison.
3. **Client cancel/reschedule is undone by the nightly top-up** for a weekly schedule (needs a migration: record the skipped week).
4. **Mark attended** should fire the low-balance alerts, and a hold should clear when a client gets sessions again (migration).
5. **Silent failed saves**, raw error text shown to users, optimistic deletes with no rollback, form basics (email trimmed, DOB range), the shared friendly-error helper.
6. **Day-one client path copy** (sign-up, claim, confirm-email, intake wording), iPhone layout (dvh, safe areas, in-app browsers), installed-app start page.
7. **Data and scale**: unbounded reads, long id lists in URLs, history import accuracy, GZCLP and training-max math, food matching.
8. **AI cost and safety caps**, privacy text (beta notice), export completeness, accessibility and page titles.
9. Duplicates and dead code clean-up.

Each of these is written up in the audit messages; none was started tonight except as listed above.
