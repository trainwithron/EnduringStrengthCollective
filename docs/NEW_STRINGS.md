# New user-facing strings (for Ron's review; nothing here blocks building)

## Release A (PWA hardening)
- Workout screen, when a set could not upload yet: "{n} change hasn't uploaded yet." / "{n} changes haven't uploaded yet." then "Saved on this phone. It uploads when you're back online." (replaces "haven't saved yet / Your numbers are still here, we'll keep trying.")
- Offline page (shown with no signal for a page that was never opened): "You're offline" / "Sets you already logged on this phone are safe and upload when you're back online. A workout you opened earlier still opens from Home." / button "Try again".

## Release B (builder reliability, assigned workouts)
- Undo bar after a delete in the program builder: "Deleted {exercise}." / "Deleted the note." / "Deleted \"{day}\"." / "Deleted Week {n}." with button "Undo" (while putting back: "Putting back…"). Failures: "Couldn't put that exercise back — add it again." (same for note, day, week).
- Deleting an exercise no longer asks "are you sure" (it can be undone for 15 seconds). Day and week confirms now end "You can undo this for a few seconds." instead of "This can't be undone."
- Builder button when a program has empty days: "Remove {n} empty day(s)"; confirm "Remove {n} empty day(s)? They have no exercises, notes or logged work." [Remove]; "Removing…"; error "Couldn't remove the empty days — try again."
- Note save errors: "Couldn't save that note — try again." / "Couldn't delete that note — try again."
- Move arrows on a day: labels "Move day earlier" / "Move day later" (screen readers).
- Client Home: a workout the coach put on one day shows under the heading "From your coach" with the coach's note.
