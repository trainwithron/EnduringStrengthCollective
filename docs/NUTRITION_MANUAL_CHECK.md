# Nutrition: signed-in click-through checks

Things the tests cannot see. Do each after the release is deployed, signed in as the people named. Tick what passes; send Spot what does not.

## Release J (About you, starting target, phase of record)

Paste `apply-release-j-all.sql` first, then deploy. Use one test client (not a real one) and a coach of that client.

**As the client (phone)**
1. Home shows a "Tell your coach about you" card. Tap "Not now": it goes away and stays away after a reload. (Clear the site's data and it comes back.)
2. Settings > Profile > "About you" opens the screen. Switch Units to kilograms: a height you typed as 5'10 becomes centimetres, a weight you typed converts, nothing is lost.
3. Fill in height, weight, sex, date of birth (only asked if the intake has none), activity, a goal, and leave body fat blank. Save. You land on Home; the card is gone.
4. Open the About you screen again: your answers are there, the date of birth is not asked again, and the goal picker is not shown (you already have a goal).
5. Home > body weight: it shows kilograms and the number you entered (80 stays 80, not 79.99). Log a new weight in kg; the coach sees it in pounds' equivalent.
6. Pick "Prefer not to say" for sex and save: nothing breaks.

**As the coach (desktop)**
7. Client > Nutrition > Targets shows an "About {client}" card with their numbers and "Born ..."; Edit changes height, sex, activity, body fat and units, and the client's own bio and phone are untouched.
8. A client with no standing target shows "Starting target" with the numbers and a sentence of reasoning. "Make this a suggestion to review" adds a card; Apply writes the target from the date you choose and the Phase card shows the phase it was worked out for.
9. A client missing a date of birth shows "Needs date of birth ..." and no number.
10. A client under 18 with a fat-loss goal: the starting target is held at maintenance and says so.
11. Phase card: Change to Reverse diet, set a review date two weeks out and a planned next phase of Maintenance. Save. The client's screens never mention the planned phase. Reload: the week count and dates are right.
12. Propose a goal as the coach, then confirm it as the client (My Goal): the phase card changes to the goal's phase from today. A coach cannot confirm it for them.
13. The weekly check-in panel opens on the phase of record, shows weights in the client's unit, and the adherence number is the real count of days logged. For a client under 18 a cut is held at the current calories with the reason in the text.

**Monday job** (run `/api/cron/nutrition-checkin-suggestions` with the cron secret once)
14. A client with complete About-you numbers and no check-in and no standing target gets exactly one starting-target suggestion and the coach gets one "A starting target is ready for ..." notice. Run it again: no second one.
15. A client who logged food on fewer than 5 of the last 7 days gets no weekly suggestion (calories held).

## Release I (food preferences and allergy safety)

1. A client with a peanut allergy never sees a peanut option in Today's meals, the calendar day, or after the coach assigns a plan: the meal says "Your coach is updating this meal."
2. A coach adds an allergy to a client who already has an assigned plan: the Meal plan section lists the days that now conflict.
3. Removing an allergy asks the coach to confirm, and the client gets "Your coach updated your allergy and food list. Check it is right."
4. A client with restrictions only in an old check-in sees the banner on the coach's Preferences section; "Fill in the form from it" fills the form and nothing is saved until Save.

## Nutrition area (one place)

1. The hub's tabs (Clients, Favorite meals, Calculator) and the client's profile Nutrition tab show the same sections.
2. Apply a suggestion from a later date: the client is told "from Oct 14", and today's target is unchanged until then.
