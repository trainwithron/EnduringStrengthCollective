# New user-facing strings (for Ron's review; nothing here blocks building)

## Release A (PWA hardening)
- Workout screen, when a set could not upload yet: "{n} change hasn't uploaded yet." / "{n} changes haven't uploaded yet." then "Saved on this phone. It uploads when you're back online." (replaces "haven't saved yet / Your numbers are still here, we'll keep trying.")
- Offline page (shown with no signal for a page that was never opened): "You're offline" / "Sets you already logged on this phone are safe and upload when you're back online. A workout you opened earlier still opens from Home." / button "Try again".

## Release C3 (progression safety rules)
- Goal sentences: "It has been {n} days since you last did this, so start back lighter: {w} ({95|90} percent of {prev})." / "It has been {n} weeks since you last did this. Check with your coach before you load it." / "You missed the reps at {w} last time. Stay at {w} and try again." / "You missed the reps at {w} {n} times in a row, so drop to {w2} and build back up." / "...Held to a 5 lb step up for your age: {w}."

## Release C2 (kilograms)
- No new words: a client who chose kilograms in About you sees "kg" where "lb"/"lbs" showed in the workout screens (set cells, goal and last-time lines, equipment badge, volume history) and the after-workout body-weight box reads "Weight (kg)".

## Release E (minors off public surfaces)
- Branding > Team: "Show me in "Find a coach"" / "Off by default. You appear only if your organization is listed and this is on." / "Name to show" / "Leave empty to show first name and last initial" / "That didn't save. Nothing was changed."
- Challenge photo save error: "Couldn't save that photo. Try again."
- Names of members under 18 on the leaderboard, records board and challenge standings are shown as first name and last initial ("Sam R."); a member who keeps their numbers private is not ranked and a private record holder shows as "An athlete".

## Release D (intake and consent)
- After the form: "You're all set." (no yes answers) or "Thanks. Because you answered yes to something, your coach will check in with you about it before you start hard training."
- Form errors: "Tick the box to accept the waiver." / "Type your full name to sign." / "That name is too long." / "Answer every health question." / "Add your date of birth first." / "We couldn't save your signature. Please try again."
- Coach, flagged screening on a client's Overview: "Health screening: {n} flagged. What do you decide?" with buttons "Cleared to train" / "Train with changes" / "Hold until cleared" and a box "Note for yourself (optional)". After deciding, in the client's settings: "Reviewed by you: Train with changes (Oct 12)".
- Assign screen: "{names} is on hold after their health screening. Check with them before you assign."

## Release C (progression and records)
- Logger: tap a set's number to mark it a warm-up (shows W; tap again to undo). Screen-reader labels: "Mark set {n} as a warm-up" / "Set {n} is a warm-up. Tap to make it a working set." Hover text "Tap to mark as a warm-up".
- Workout start screen: under "Goal: 140 lbs x 5 reps" one plain sentence of why, for example "You hit 12 reps on every set at 135, so up to 140." / "Same weight, 135: your lowest set last time was 9 reps, so aim for 10 on every set." / "5x3+ at 100, worked out from your last 6 sessions." / "140 x 5: 2 steps up from your first session (135 x 5)."
- 1-rep-max calculator: "Enter a weight and 1 to 8 reps for an estimate. Use a set of 8 reps or fewer: an estimate from more reps is not reliable. Add how hard that set felt (RPE, 1-10) for a more accurate estimate; leave it blank and it is treated as RPE 9, the same assumption your saved training maxes use."
- Share card "est. 1RM" line now uses the same estimate; for a set of more than 8 reps it says "new weight PR" instead.

## Release B (builder reliability, assigned workouts)
- Undo bar after a delete in the program builder: "Deleted {exercise}." / "Deleted the note." / "Deleted \"{day}\"." / "Deleted Week {n}." with button "Undo" (while putting back: "Putting back…"). Failures: "Couldn't put that exercise back — add it again." (same for note, day, week).
- Deleting an exercise no longer asks "are you sure" (it can be undone for 15 seconds). Day and week confirms now end "You can undo this for a few seconds." instead of "This can't be undone."
- Builder button when a program has empty days: "Remove {n} empty day(s)"; confirm "Remove {n} empty day(s)? They have no exercises, notes or logged work." [Remove]; "Removing…"; error "Couldn't remove the empty days — try again."
- Note save errors: "Couldn't save that note — try again." / "Couldn't delete that note — try again."
- Move arrows on a day: labels "Move day earlier" / "Move day later" (screen readers).
- Client Home: a workout the coach put on one day shows under the heading "From your coach" with the coach's note.
