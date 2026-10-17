# Needs Ron (questions only he can answer; ASSUMED = built on the recommended answer, veto any time)

## Release A (PWA hardening)
- ASSUMED: starting a brand-new workout with no signal at all is NOT built. A workout page opened once while online reopens offline and keeps logging (sets are kept on the phone and upload later). Creating a new workout offline needs the server to make the session first; recommended to do it later together with prefetching the next 7 days of assigned workouts.
- ASSUMED: an installed app in a window 1024px wide or more with a mouse opens the desktop experience (a phone or touch tablet keeps phone mode; the existing view toggle still overrides).
- Needs Ron: name an iPhone tester (offline and wake-lock behaviour differ on iOS).

## Release B (builder reliability)
- ASSUMED (changes an earlier decision, veto any time): empty days are no longer removed automatically when a program opens; a "Remove N empty days" button asks first. Reason: the automatic removal could delete a day the coach had just created in another tab or planned to fill.
- ASSUMED: deleting an exercise has no confirm (undo for 15 seconds instead); deleting a day or week keeps its confirm and adds undo.
- Undo puts back the same rows with the same ids. It cannot bring back client history that was attached to a deleted day (that was never deleted: only the template goes).
