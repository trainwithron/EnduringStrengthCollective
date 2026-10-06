# Ship order for today (Oct 6)

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
      - Wording: "coach" everywhere instead of "trainer", and Spotter / Ask Spot instead of "Collective Intelligence".
      - Exercise demos: open a workout and tap **Demo** under an exercise (try Bulgarian Split Squat). A sheet slides up with the video, big, and it does not play until you press play; it should show the Rear Foot Elevated Split Squat video. Close it with Close or by tapping outside. Also try an exercise you add or swap in the middle of a workout. In Settings > Workout Logging, **Hide exercise demos** removes the button (saved on that phone only; following you across phones is a later step).

## What is NOT in today's list

- The exercise catalog and "time to progress?" are designs for you to answer (docs\EXERCISE_CATALOG_DESIGN.md, docs\TIME_TO_PROGRESS_DESIGN.md). Nothing is built or applied for them.
- Make sure the Vercel setting `ATTENDANCE_NUDGE_AUTO_SEND` is NOT set (it turns automatic attendance texts back on).
