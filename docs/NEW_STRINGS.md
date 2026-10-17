# New user-facing strings (for Ron's review; nothing here blocks building)

## Release A (PWA hardening)
- Workout screen, when a set could not upload yet: "{n} change hasn't uploaded yet." / "{n} changes haven't uploaded yet." then "Saved on this phone. It uploads when you're back online." (replaces "haven't saved yet / Your numbers are still here, we'll keep trying.")
- Offline page (shown with no signal for a page that was never opened): "You're offline" / "Sets you already logged on this phone are safe and upload when you're back online. A workout you opened earlier still opens from Home." / button "Try again".

## Release F (silent failures, wording)
- A bar at the bottom of any screen when a save did not go through: "That didn't save. Try again." with "Dismiss". (Shown for the 85 saves that used to fail silently: calendar events, habits, recipes, tags, notes, rest and sets edits, and so on.)
- A whole page in place of one whose data could not be read: "Couldn't load this. Try again." with "Try again" (about 60 coach pages, and the workout page, which used to say "This session isn't available" or show an empty workout).
- Failures from the server no longer show technical text: "Couldn't start checkout: Try again in a moment." (was the provider's own message).
- Menu labels in sentence case: Team feed, Session ledger, Quick tips, Display mode, Kiosk check-in, Exercise library, Pro shop and referrals, Support inbox, Depth chart, Booking page, Session types, Team performance, Team calendar, Group sessions, Hall of fame.

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

## Duplicate week without progressions
- Button on a week: "Duplicate week →" (was "Duplicate with progression →"); panel heading "Duplicate Week N".
- First choice in the model row: "Copy as is". Line under the choices: "Copies every exercise, set, rep target, weight, rest and note exactly as Week N has them. Nothing is progressed."
- The action button for it reads "Copy N weeks" ("Copying…" while it works).

## Release H (importers, export, getting out, what you coach)
- History import: "Row {n}: {reason}" with reasons such as: The date "{x}" could not be read (use 2026-01-15 or 1/15/2026). / The reps "{x}" are not a single count (a range such as 8-12 is not a number of reps performed). / The weight "{x}" is not a plain number (a range or a note is not a weight that was lifted). / The RPE "{x}" is not a number. / No exercise name. / No weight and no reps. / weight {n} lb is over 2,000 lb: not a real set. / "{n} row(s) was/were not read. Fix it/them in the file and import again; nothing here is lost." / "kept as an unclear data point: {reason}".
- History page: "A spreadsheet import: {n} workout(s)" [Undo this import]; confirm "Undo this import? Its {n} workout(s) will be removed. Anything logged live or typed in is not touched." [Undo import]. Quick entry limits: "A weight can be at most 2,000 lbs." / "Reps can be a whole number from 0 to 1,000." / "RPE can be from 0 to 10."
- Program spreadsheet preview: "This is what was read from your file. Nothing has been created yet." and "{n} row(s) has/have no exercise name and was/were left out (row(s) ...)."
- Roster: tab "Paste a list"; "Paste names, one per line. Put an email after a comma if you have it. Up to 100 at a time."; [Preview]; "or choose a .csv / .xlsx file"; "Add {n} people to {group}? Nothing is sent to them."; "{n} added to {group}. Nothing was sent to them."; "{n} not added:"; [Undo this import]; "Import undone: {n} removed."; line reasons: No name on this line. / is not a full email address. Fix it or take it out to add them without one. / is already on an earlier line. / only 100 people can be added at a time.
- Export: [Export my business]; "Preparing… this can take a minute"; "A zip of spreadsheets: your clients, programs, workouts, every logged set, bookings, credits and notes. It is yours to keep, any time."
- Team tab: "Coaches" list with "{n} clients", "Make an admin" / "Make a coach", "Remove"; "{name} is the only coach of {n} client(s). Who takes over?"; remove confirm "Remove {name} from {org}? They lose access to every client here right away. Their {n} client(s) stay with {org} and {coach} takes over, with all history, programs and credits. A client who keeps their records private from the organization leaves with {name}."; "Waiting to answer" [Give 14 more days] [Cancel]; "Close this organization": "Closing {org} ends the team. Every other coach leaves and takes the clients only they coach, each into an organization of their own. Groups with several coaches stay with you. Download your data first. Billing is not changed here." "Type {org} to confirm" [Close it].
- Leave: "You are the only coach of {n} client(s). Who takes over?"; confirm text as above.
- Signup and Settings: "What do you coach?" / "One-on-one clients" (Personal training or online coaching.) / "A team or a class" (A school or club team, a class or a group program.) / "A gym with several coaches" (You run the business and other coaches work with you.); error "Tell us what you coach."; first group for a team: "My Team".
- Add client: "Who coaches them" (Me / a coach); "{name} is their coach now."

## Release I (gym owner tools, first-day gaps)
- Add client, someone who already has an account: "They already have an account, so we sent them an invitation." / "They have already been invited." / "{email} sees it in the app and by email, and joins your space only if they accept. Nothing else is shared with you until they do." Errors: "That is your own address." / "They are already in this space." / "That email already has an account. Use the group's invite link instead so they join with their own login."
- Invitation page: "Be {coach}'s client?" / "{coach} invited you to train with them in a space of your own. You join only if you accept. Your records with your other coaches stay separate and private from them." [Accept] [No thanks]; "This invitation is not open" / "It may have been answered or expired. Ask your coach to send a new one." Notice: "{coach} invited you to be their client." Email subject "{coach} invited you to be their client"; "{Org} invited you to join".
- Email body: "{notice}" then "Open this link to see it and answer: {link}" then "You are getting this because someone invited you on Spotlight Coaching. If you were not expecting it, you can ignore it; nothing happens unless you accept."
- Team tab: "Message your coaches" / "A short note every coach on the team will see in their notifications." [Send to the team] / "Sending…" / "Sent to {n} coach(es)." / "Keep it to 500 characters or fewer." / "There is nobody else on the team yet." / "Coach activity and payroll estimate →"; "Send again" (was "Give 14 more days").
- Coach activity page: "Coach activity"; "What each coach has done in the period. A session counts when it was confirmed, its time has passed and it was not a no-show. Clients who keep their records private from the organization are not counted."; columns Coach, Clients, Sessions, No-shows, Late cancels, Quiet 14+ days, Low on sessions, Rate per session ($), Estimate; "Session credits sold in this period: {n}."; "The estimate is sessions delivered times the rate you type. It is an estimate to check against pay, not payroll: the rates are not saved and nothing is paid from here. The spreadsheet lists every session behind the numbers."; [Download the sessions (spreadsheet)]; "Some of this could not be read, so the numbers below may be too low. Reload the page to try again."; "This period has more than the page can show. Choose a shorter period."
- Your coaches: "Your coaches" / "Pick who you are training with. Each coach has their own space, and what you do in one is not shown in the others."; Settings link "You train with more than one coach. Switch between them →".

## Release J (coach Home, seasons, attendance)
- Bar at the top of the client app (coach): "Me" / the client's name with a dropdown arrow (opens the client picker); "Coach home" / "Going…". Spot button: the existing Spotlight button, now on these pages.
- Feed (coach's own app): "Group" dropdown (group name, and the organization's name when there is more than one); "Your groups' feed shows here once you coach a team or a group. A client's own space has no feed."
- Team page: [Start next season]; "Name of the new season"; "Athletes coming back ({n} of {m})"; [Tick all] [Untick all]; [Start the season] / "Starting…"; confirm "Start {name} with {n} athlete(s)? {Old} is retired: it and all its records are kept in Past seasons, and nothing from it is copied into the new season." [Start the season]; "Past seasons"; "This season is retired. It and its records are kept here." [Bring it back]. Menu: "Seasons", "Attendance".
- Attendance page: "Attendance"; "Who was there, day by day. Present means checked in at the kiosk, finished a workout in this group, or attended a group session that day ({zone})."; "Athlete", "Days", "Last there", "There each day", "Not in this period", "Checked in" / "Finished a workout" / "Attended a session" / "Not there"; [Show] [Download (spreadsheet)]; "There are no athletes in this group yet."; "A period longer than 31 days shows the number of days each athlete was there; the spreadsheet has every day."; "Some of this could not be read, so people may show as absent who were there. Reload the page to try again."

## Release K1 (notifications)
- Settings > Notifications: "Quiet hours" / "No notifications are sent to your phone during these hours. They are still waiting for you in the app." with "{h}:00 am/pm" menus and "until"; "Private lock screen" / "Your phone shows "You have a new notification" instead of names and details."; "Saved." / "Couldn't save that. Try again."
- Pushes: title "Payment received", body "Open the app to see who paid." (the notice in the app says "{client} paid {amount} for {n} sessions.") / "for a membership renewal" / "for {description}"; "New booking request", "A session changed late", "New schedule request", "Your request was answered" with body "Open the app to answer it." / "...to see it." / "...to see the answer."; invitations use the invitation's own title ("{Org} invited you to join", "{coach} invited you to be their client"); the team announcement uses the organization's name as the title. Private lock screen: title "Spotlight Coaching", body "You have a new notification."
