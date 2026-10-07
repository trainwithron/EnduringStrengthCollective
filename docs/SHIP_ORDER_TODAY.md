# Ship order (Oct 6)

## HOW EVERY RELEASE IS PASTED FROM NOW ON: ONE file

Each release gets **one bundled paste file**, `supabase\apply\apply-release-<x>-all.sql`. It runs all of that release's steps, in the right order, inside one all-or-nothing transaction. Each step's checks (everything its separate precheck says, including "not already applied") are built in as a guard in front of it, so there is **no separate precheck paste**. If a check is false the run stops with a red message that names the release, the step and the failed check, and nothing is kept, so it is safe to try again after fixing what it names. After the commit it shows a read-only result table, one row per step, and every row must say `in_place = true`. The separate `apply-stepNN-...` and `undo-stepNN-...` files stay as the fallback and for undoing one step at a time. If a step was already applied by hand, the bundle refuses at that step (by name); use the single-step files for the rest. The paste test applies each bundle on the live-shaped schema, proves a bad state in the last step keeps nothing of the earlier ones, proves a second run is refused, and proves each step's undo file still works afterwards.

## RELEASE D: ready, not pushed (the list below it is Release C, which is live)

**One-file way (Release D): `apply-release-d-all.sql`** runs steps 32, 33 and 34 together; use it only if none of them is applied yet. Steps already applied by hand (32 done, 33 in progress) are covered by the numbered list below.

Branch `release-d` (one merged, green branch: booking at any time, the fixes from the live check, session types on hours, the vocabulary change). Nothing in it is applied or deployed. Do the pastes first, in this order, each only after Assistant has reviewed it against live (each file refuses by itself if it was already applied or is out of order):

1. **Step 32** (`apply-step32-0287-precheck.sql`, then `apply-step32-0287.sql`): a session may be longer than the time between slot starts (a start every 15 minutes with a 55-minute session). You should see 3 rows `true`, then "Success. No rows returned."
2. **Step 33** (`apply-step33-0288-precheck.sql`, then `apply-step33-0288.sql`): two bookings that overlap at different minutes can no longer both be saved at the same instant. You should see 2 rows `true`, then "Success. No rows returned." Nothing visible changes.
3. **Step 34** (`apply-step34-0289-precheck.sql`, then `apply-step34-0289.sql`): a window of hours can be tagged with one of your session types, and a booking made inside it is tagged the same. You should see 3 rows `true`, then "Success. No rows returned." Nothing visible changes at once.
4. Then type **`push and deploy release D`**.

What to try after it is live (phone and desktop):

- **Availability:** each window has **Slot every**, **Session length** and **Gap between sessions** side by side, with a line like "Slot every 60, session 55, gap 5 = 6:00–6:55 AM, 7:00–7:55, 8:00–8:55, …" and a warning (never a block) if they fight each other. 15, 30, 45 and 60 are one-tap choices. The gap is the same setting as "Buffer between sessions". "Slot every 15" with "Session 55" saves once step 32 is applied. Under **Session type** (optional) pick Online, In person and so on for a window.
- **Business > Session types:** one tap adds Online / In person or Weight room / Practice / Game (private, rename or delete them as you like).
- **A client's day on the calendar:** each booked session shows its type and lets you change it. **Another time** books any start in 5-minute steps and any length; outside your hours is a warning only.
- **A client in request mode:** under the open sessions there is **Ask for a different time**; the request on your Home shows start to end, your time zone, and a note if it is outside your hours.
- **Calendar Spot** rows (for example "Alice hasn't attended a session in 19 days"): **Not now** (2 weeks), **Don't flag Alice** (60 days), the next session with Cancel, and the session type.
- **Scheduling Spot:** one line, "You have gaps in your schedule. Are you looking to fill them, or happy where you are?" with **Looking to fill them** / **Happy where I am**; fill them asks Online / Hybrid / In person.
- **What do you call your people?** on Home (asked once) and in Settings: pick Clients, Athletes, Players, Members or your own word. It then reads as plain text everywhere (no underline), in proper case at the start of a label.

Not in Release D: the Ask Spot action layer, the messages synopsis and the "I'm away" flow (designs only), and the server hours check inside `book_session` (queued for mid-November).

---

# Release C list (live since Oct 6; kept for the record)

One list, in order. Do a line, check what you should see, then the next. If anything is not what it says, stop, run `rollback;` once if it was a paste, and send Spot the red text or the table. Nothing in a paste file runs twice by accident: each one refuses by itself if it was already applied.

All paste files are in `supabase\apply\` in the a3 worktree. Run the **precheck** file first (every row must say `ok = true`), then the **apply** file (it must say "Success. No rows returned.").

Already applied by you: steps 12 to 22 and 24. You do not touch those again.

## Part 1: the desktop rail (code only)

1. Type **`push and deploy the rail`**. I push `safe-home-pulse` (the left rail that stays on Home, plus Client Pulse showing "N need attention" with Snooze) and deploy it.
   - You should see: Home keeps the full left rail (Clients, Calendar, Messages, Programming, Nutrition, Business, More tools) and the business name at the top is a menu. Client Pulse starts as one row, for example "6 need attention", that opens to a list with Snooze 7 days on each.

## Part 2: the database pastes

2. **`check-step23-probe.sql`** (run once, changes nothing).
   - You should see a RED error whose text starts `PROBE RESULT (rolled back, nothing kept)` and says all four cases are `true`. That red error is the expected answer. Then run `rollback;` once.
3. **Step 23** (`apply-step23-0281-precheck.sql`, then `apply-step23-0281.sql`): clients can be set aside as inactive.
   - You should see: all `true`, then "Success. No rows returned."
4. **Step 25** (`apply-step25-0283-precheck.sql`, then `apply-step25-0283.sql`): session length separate from the slot step.
   - You should see: all `true`, then "Success. No rows returned." Nothing visible changes yet.
5. **Step 26** (`apply-step26-move-home-team-precheck.sql`, then `apply-step26-move-home-team.sql`): moves The Home Team into Coast2Coast Fitness.
   - You should see: 5 rows `true`, then "Success. No rows returned." The Home Team now shows under Coast2Coast Fitness.
6. **Step 30** (`apply-step30-copy-main-group-program-precheck.sql`, then `apply-step30-copy-main-group-program.sql`): copies `christmas_abs_program` into The Home Team. Nothing is deleted.
   - You should see: 4 rows `true`, then "Success. No rows returned."
7. **`check-copy-result.sql`** (read-only): look at it.
   - You should see two rows, `original (Main Group)` and `copy (The Home Team)`, with the **same** numbers in workouts, exercises, sets, notes and progressions. If they differ, do NOT run step 31; send Spot the table.
8. **Step 31** (`apply-step31-delete-two-groups-precheck.sql`, then `apply-step31-delete-two-groups.sql`): deletes Main Group and the stray "Coast to Coast" group. It saves both in full to `cleanup_backups` first and refuses by itself if either has a client, a logged workout, a booking, a purchase or a balance.
   - You should see: 5 rows `true`, then "Success. No rows returned." If it refuses, the red text says why and nothing was deleted.
9. **Step 27** (`apply-step27-0284-precheck.sql`, then `apply-step27-0284.sql`): a coach can suggest a goal and the client confirms, changes or declines it.
   - You should see: 3 rows `true`, then "Success. No rows returned."
10. **Step 28** (`apply-step28-0285-precheck.sql`, then `apply-step28-0285.sql`): the record that limits rest-day nudges (at most 2 in 7 days, none after 3 with no response).
    - You should see: 2 rows `true`, then "Success. No rows returned." Until this runs, the app sends no rest-day nudges at all.
11. **Step 29** (`apply-step29-0286-precheck.sql`, then `apply-step29-0286.sql`): favorite foods.
    - You should see: 2 rows `true`, then "Success. No rows returned."
12. **`check-function-acl.sql`** (read-only, the permanent permissions check).
    - You should see: 4 rows, every one `true`, and no row that starts `UNREVIEWED`.
12b. **Step 32** (`apply-step32-0287-precheck.sql`, then `apply-step32-0287.sql`): a session may be longer than the time between slot starts (a start every 15 minutes with a 55-minute session). Run it any time after step 25, and only when the booking-times release is out.
    - You should see: 3 rows `true`, then "Success. No rows returned." Nothing visible changes at once.
13. **`record-history-applied.sql`**: puts the hand-applied steps into the migration history.
    - You should see: "Success. No rows returned."

## Part 3: the main release (code)

14. Type **`push and deploy release C`**. I push `release-c` and deploy it.
    - You should see, once it is live:
      - Availability: each recurring window has Edit, Copy to other days and Delete; "Session length for all your hours" (30 to 60 or your own). For 06:00 to 06:55 then 07:00 to 07:55, pick 55 and set the buffer to 5 under Booking rules.
      - Needs your decision: "Probably inactive" and the expiry check-in cards; a Set aside / Bring back control on a client's profile.
      - A client's profile: "Suggest a goal". The client sees "Your coach suggested a goal" on My Goal.
      - A client's nutrition log: stars to save favorite foods and a Favorites row.
      - A client's Settings: "Sharing to the group feed" for group members.
      - The post-workout card appears for every client, including ones who keep workouts off the group feed and one-on-one clients.
      - Calendar: a "Send a note" button on a gap instead of any automatic text.
      - Time to progress?: on Home a collapsed row "N need a look" (only when a client's main lift has sat at the same load and reps for 3 or more sessions). Open it: at most 3 cards with Yes, deliberate / Show me options / Not now; "I'll ask after 3 sessions. Change" at the bottom. On a client with their own program, Show me options then Apply changes only their next workout. On a client's profile, "Turn this into a goal" appears once they have replied to the "what do you need most help with?" message.
      - Booking at any time (needs the booking-times code): Availability has 15, 30, 45 and 60 as one-tap "Slot every" choices (after step 32, "Slot every 15" with "Session 55" saves). In request mode a client sees "Ask for a different time" under the open sessions: pick a start like 6:20 and it arrives on your Home as a request showing the start to end, your time zone and a note if it is outside your hours. On a client's day, "Another time" books any start and length for them. A session at an off-slot minute no longer shows as an open slot, and is not flagged as "no longer fits your hours" by the nightly check.
      - Wording: "coach" everywhere instead of "trainer", and Spotter / Ask Spot instead of "Collective Intelligence".
      - Exercise demos: open a workout and tap **Demo** under an exercise (try Bulgarian Split Squat). A sheet slides up with the video, big, and it does not play until you press play; it should show the Rear Foot Elevated Split Squat video. Close it with Close or by tapping outside. Also try an exercise you add or swap in the middle of a workout. In Settings > Workout Logging, **Hide exercise demos** removes the button (saved on that phone only; following you across phones is a later step).

## What is NOT in today's list

- The exercise catalog and "time to progress?" are designs for you to answer (docs\EXERCISE_CATALOG_DESIGN.md, docs\TIME_TO_PROGRESS_DESIGN.md). Nothing is built or applied for them.
- Make sure the Vercel setting `ATTENDANCE_NUDGE_AUTO_SEND` is NOT set (it turns automatic attendance texts back on).
