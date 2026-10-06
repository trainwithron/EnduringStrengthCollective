# "Time to progress?" — design (no build until Ron says yes)

A quiet question to the coach, in the same style as the "Probably inactive" and "A check-in worth making" cards. It never changes a program, never messages a client, and never decides for the coach.

## What the coach sees

One line per client and exercise, under Needs your decision:

> **Sam's back squat has been 225 × 5 for 4 sessions, and it felt easier each time (effort 8, then 7, then 7).** Did you notice this?
> `Yes, deliberate` · `Show me options` · `Not now`

- **Yes, deliberate**: the coach is holding it on purpose. The card stays away for that client and exercise for 6 weeks, and the Spotter learns this coach holds loads longer.
- **Show me options**: opens a small panel with plain choices, each producing a draft the coach confirms, never an automatic change: *add 5 lb next week*, *add a rep next week*, *keep it and look again in 2 weeks*, *change it only in Sam's own program*. Nothing is written until the coach taps Apply.
- **Not now**: 14 days away.

Neutral wording only: no "stalled", "plateau" or "stuck". It says what was logged and asks if the coach noticed.

## What triggers it (soft evidence, not a rule)

Read straight from `set_logs` (weight, reps, effort) and the session dates, like `lib/matched-load-trend.ts`. No new schema, no AI.

1. The same top-set load and reps for several consecutive sessions of that exercise.
2. Effort is flat or falling, or the athlete is finishing every set (the sets get easier, not harder).
3. The program is not already about to raise it: if next week's target for that exercise is higher, nothing shows (a Linear, Double or Undulating week already handles it).

There is no fixed "N sessions" threshold. The first card for a coach appears at 3 sessions; the number is then that coach's own (see Learning). Fewer than 3 logged sessions never triggers it.

## What suppresses it

- Exercises that are not primary or secondary (tier A or B); accessory work is the coach's call and would be noise.
- A deliberate deficit phase (the same suppression the matched-load fatigue watcher uses), a deload week, or a recent injury or pain note.
- The client is set aside as inactive, or has not trained in 21 days.
- A cap of 3 of these cards on Home at once, oldest evidence first, so the list never grows into the long list Ron already dislikes.

## Learning, per coach (no new table)

Uses the existing `spotter_recommendation_feedback` rows (`spotter_kind = 'progress'`, key = client + exercise):

- The number of sessions needed starts at 3 for a new coach. Each "Yes, deliberate" answer raises it by 1 (up to 6); each time a coach opens options and applies one it lowers it by 1 (down to 3). So a coach who holds loads is asked less and a coach who always progresses is asked sooner.
- It is shown on the coach's own screen as a small "I'll ask after N sessions. Change" so it is never a hidden rule.

## What it needs built

- A pure function `progressNudge(points, programTargets, coachThreshold)` plus tests (like `matched-load-trend`).
- A gather step on Home for the coach's active clients (the same queries the matched-load watcher already makes).
- The card component, reusing the quiet card layout and the same answer buttons.
- The options panel, which writes through the existing program builder paths (personal program edits), never directly.

## Questions for Ron before building

1. Only the main lifts (tier A and B), or any exercise the coach marks?
2. For clients who do not log effort: use "finished every set at the same load for N sessions" alone, or skip them?
3. Is a limit of 3 cards at a time right, or should it be a count that opens (like "6 need attention")?
4. Should "Yes, deliberate" also tell the client anything? (Proposal: no, it stays between the coach and the app.)
