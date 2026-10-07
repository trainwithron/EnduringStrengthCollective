# Warm-up sets (design on file, Oct 7)

**Status: NOT NOW.** Ron (Oct 7): "You don't have to concern yourself with the warm-up weights." Nothing is built and nothing will be until he says so. This note keeps the investigation so it does not have to be redone. Source: a full read-only survey of every reader of `set_logs` plus the live database (SELECT only).

## The idea
A client who did a set without going all out ("I did 5 but didn't go all out, should I add a set?") marks it a warm-up: it stays logged, looks lighter, and never counts as a working set anywhere. Ron's answer to the client: if it was not productive, do not count it as a working set.

## Design
- **Data:** `set_logs.set_type` ('working' default | 'warmup'), NOT NULL, with a CHECK. Every existing row is 'working' (no backfill). Old code on the new database is fine with the default.
- **UI:** long-press on the set number (or a small W chip) flips working and warm-up, with a haptic tick and a 6-second Undo (one reversible update; the same pattern as remove-set). A warm-up column is lighter and shows "W"; working sets keep counting 1, 2, 3. A warm-up may skip or shorten the rest-timer prompt.
- **Remove-set interaction:** marking a warm-up is the safer alternative to removing a logged set in the "didn't go all out" case (reversible, keeps the data). The remove confirm could offer "Mark as warm-up instead". It is not an alternative for a typo (4508 lb): neither retracts the training max.
- **After completion:** only the coach can change sets of a finished workout (the completed-workout lock). Flipping re-totals volume and sets (the recompute trigger fires), but `new_prs` and `exercise_records` were fixed at completion: disallow it for finished workouts in v1, or add a repair step.
- **Training max:** `recompute_training_max` only raises and never retracts. A heavy set completed and THEN marked warm-up has already raised the max (rare). The real fix is a coach "reset max" control (queued with the remove-set typo case). A warm-up with no RPE is assumed RPE 9 by that trigger, which inflates the estimate, so the trigger must skip warm-ups.
- **Targets by working-set index:** `set_order` is the join key from a logged set to the coach's template target (sessions page, `workout-overview-data`, `progress-look-gather`, `session-pattern-spotter-gather`). Map by the k-th WORKING row to the k-th template target so a warm-up does not shift targets onto the wrong rows (one helper, about half a day).
- **Prescribed warm-ups later:** a template-level `set_type` on `group_workout_exercise_sets`, written by `start_workout_session` (an invoker function: `CREATE OR REPLACE` from live text), a builder toggle, and a "ramp" helper that proposes warm-up sets from the top set.

## What must exclude warm-ups (so nothing double-counts)
Almost everything downstream reads the STORED `workout_logs.total_volume / total_sets_completed / new_prs` (leaderboard, feed, share totals, dashboards, coach profile list, AI chat last session, webhooks, milestone cron, program cards), so it is fixed by fixing SQL. Do NOT add warm-up filters to those readers.

- **SQL (live text, `CREATE OR REPLACE` only, ACL asserted unchanged; live `complete_workout_session` is the current 0236+settlement text):** `recompute_workout_log` (volume and sets), `complete_workout_session` (17 places: volume, sets, `new_prs`, the best-set CTEs, `exercise_records` candidates, supersede and insert), `recompute_training_max` (the guard).
- **TypeScript (about 25 sites):** `lib/progressions.ts` (the AMRAP pick takes the highest `set_order` row; the heaviest-set reference), correlating-week suggestion history (sessions page, `workout-overview-data`), "Last time: W x R" (3 places), priorBest and obstacle-unlock, `lib/shared-workout.ts` (best by exercise, PR baseline, relative strength), the client profile progress chart, the three matched-load trend gatherers (`dashboard-data`, `coach-briefing-gather`, `collective-intelligence-lookups`), `equipment-load-ratio-gather` (also has NO status filter today: pending prefilled sets leak in), `progress-look-gather` (one non-completed set marks the session "missed"), `session-pattern-spotter-gather` (three sites; warm-ups leave numerator and denominator), `session-integrity-data` (rest floor), `program-card-data`, recap data (shown distinctly), `equipment-visual`, `session-progress-strip`, the Sets stepper count, `prescribedNote`, `canRemoveSet`, `restoreSetRow` (Undo must carry `set_type`), `allSetsResolved` (a pending warm-up must not trigger "not fully filled"), and every place that builds a `SetLogEntry` (about 5 sites).
- **Guard for the future:** a test that every `from("set_logs")` call site either filters on `set_type` or is on an explicit allow-list (Assistant's suggestion).
- **Not changed:** export (set_logs is not exported), deletion (cascade), credits and settlement (no set dependence).

## Database and order
ONE bundled paste: the column and check plus the three function rewrites, rehearsed through a full complete-workout fixture (volume, sets, `new_prs`, `exercise_records` and max exclude warm-ups; flipping re-totals; the lock still refuses an athlete after completion). Paste BEFORE the code deploy (the new selects need the column).

## Cost
About 6 to 7 working days in all (SQL and rehearsal 1.5, UI 1.5, TypeScript exclusions and the targets mapping with tests 3, coach display 0.5). A first version of about 4 days (column, control, the three SQL functions, last-time, priorBest, progressions, suggestions, stepper and `allSetsResolved`, session page and recap display, the mapping helper) with the spotters, integrity floor and load-ratio in a second release.
