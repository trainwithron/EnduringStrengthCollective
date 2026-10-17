# Needs Ron (questions only he can answer; ASSUMED = built on the recommended answer, veto any time)

## Release A (PWA hardening)
- ASSUMED: starting a brand-new workout with no signal at all is NOT built. A workout page opened once while online reopens offline and keeps logging (sets are kept on the phone and upload later). Creating a new workout offline needs the server to make the session first; recommended to do it later together with prefetching the next 7 days of assigned workouts.
- ASSUMED: an installed app in a window 1024px wide or more with a mouse opens the desktop experience (a phone or touch tablet keeps phone mode; the existing view toggle still overrides).
- Needs Ron: name an iPhone tester (offline and wake-lock behaviour differ on iOS).

## Release C (progression and records)
- ASSUMED (from the research report, veto any time): loads round DOWN to 5 lb (a percent of a max) so no one is asked for a weight that cannot be loaded; a step up never rounds back to where it started; the 5 lb step is fixed for now (a per-coach 2.5 lb micro-plate setting and kg athletes need the units work below).
- ASSUMED: a training max / "est. 1RM" comes only from sets of 1 to 8 reps (was 1 to 12 in the database and 15 in the calculator); a set with no RPE counts as RPE 9; the calculator without RPE now gives the same number as the stored training max (about 3 percent higher than plain Epley).
- ASSUMED: a personal record is "no earlier set was at least as heavy for at least as many reps"; a longer hold is a record. Existing hold records in exercise_records were stored as "shorter is better" and will correct themselves as new holds come in; they are not rewritten.
- NOT DONE (needs a decision, simplest path recommended): one unit per athlete (kg or lb). Weights are stored exactly as typed and every label says lbs. Recommended: store pounds (as today) and convert for display for athletes who choose kg, in the logger, history, recap, targets and share cards. That touches every weight label (about 60 files), so it is its own release; say go and I build it next.
- NOT DONE, parked with the reason: the failure ladder (hold, hold, reset 10 percent on the third miss), the gap rules (14 / 28 / 56 days), the minor +5 lb cap and the ask-the-coach list. They need a per-exercise miss counter and a coach notice; the report asks Ron to approve the numbers first (decisions 2 to 5 at the end of docs/research/progression-periodization.md).

## Release B (builder reliability)
- ASSUMED (changes an earlier decision, veto any time): empty days are no longer removed automatically when a program opens; a "Remove N empty days" button asks first. Reason: the automatic removal could delete a day the coach had just created in another tab or planned to fill.
- ASSUMED: deleting an exercise has no confirm (undo for 15 seconds instead); deleting a day or week keeps its confirm and adds undo.
- Undo puts back the same rows with the same ids. It cannot bring back client history that was attached to a deleted day (that was never deleted: only the template goes).
