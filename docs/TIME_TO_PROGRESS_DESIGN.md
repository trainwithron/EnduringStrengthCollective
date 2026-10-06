# "Time to progress?" — design (final plan, Ron's answers in; not built yet)

## The principle

This exists to make it easy for the coach to coach, not to replace him. Everything here is a suggestion, a draft the coach edits, or a quiet question. **Nothing is automatic to a client**, nothing is changed in a program without the coach tapping Apply, and no number below is a rule: they are rough guidelines the coach can change. People do not progress every week, and a week with no change is never failure.

Same family as the "Probably inactive" and expiry check-in cards: one collapsed row on Home, plain wording, the coach answers.

## What the coach sees

One collapsed row on Home: **"4 need a look"** (the count can grow to 6 or more). Opened, it shows at most **3 cards at a time**, the oldest evidence first, so it never becomes a long list.

A card points at the **workout**, not one lift, and says what looks odd inside it:

> **Sam's Tuesday lower workout.** Back squat 225 × 5 for the last 4 sessions, and the effort has come down (8, then 7, then 7). Romanian deadlift has not moved in 3 weeks. Did you notice this?
> `Yes, deliberate` · `Show me options` · `Not now`

- **Yes, deliberate**: the coach is holding it on purpose. That client and workout stay quiet for 6 weeks, and the Spotter learns this coach holds loads longer.
- **Show me options**: plain choices, each a *draft* the coach edits and applies: a bit more load, a rep, a set, better control, or the same load at lower effort; or keep it and look again in 2 weeks; or change it only in this client's own program. Nothing is written until the coach taps Apply.
- **Not now**: 14 days away.

Neutral words only: never "stalled", "plateau" or "stuck", never blame.

## What counts as a main lift

The coach decides. By default the main lifts are the ones already tagged tier A or B in the exercise library (the app already has this); the coach can mark any exercise as a main lift the same way (set its tier). No new table. The card is about the workout the main lift lives in, and it flags anything else odd in that workout.

## The second signal, a week later

If a client's main lifts are moving but the accessories are not, the coach gets a separate, delayed, soft card **the following week**: "Sam's main lifts are moving; the accessories haven't." It is a different card from the first (so the first is never crowded), and the same answers apply.

## What triggers a card (soft evidence)

Read straight from the set logs and the session dates, like the matched-load watcher. No AI.

1. The same top load and reps across several consecutive sessions of a main lift, with no change planned: if next week's target for that lift is already higher, nothing shows (a progression model already handles it).
2. **If the client logs effort:** the same load at falling effort counts as progress, and the card says so ("same weight at lower effort is getting stronger"). The soft "ready to progress" signal is effort settling around 6 to 7 at the same load.
3. **If the client does not log effort (some people dislike it, some coaches will not require it):** assume they are working hard, close to their best. Use "same load and reps for N sessions" on its own. These clients are never skipped.
4. One optional hint, clearly labeled **"a rough guide you can change"**: the common rule of thumb that going 1 or 2 reps over target on two sessions in a row is a sign it may be time to add a little load. It is one hint among the rest, not a trigger and not a rule, and the coach can switch it off.

No number is hard-coded in the wording or the logic as a requirement. The suggestion text is always the broad one: **"some form of progress: beat the weeks before"**, meaning a bit more load, a rep, a set, better control, or lower effort at the same load. The coach edits it.

## What suppresses it

- A deliberate deficit phase, a deload week, a recent injury or pain note (the same suppressions the fatigue watcher already uses).
- A client set aside as inactive, or one who has not trained in 21 days.
- The coach's own answers (below).

## Learning, per coach (no new table)

Uses the existing `spotter_recommendation_feedback` rows, kind `progress`, keyed by client and workout:

- The number of sessions before a card appears starts at 3 for a new coach. Each "Yes, deliberate" raises it by 1 (up to 6); each time options are opened and one is applied it lowers it by 1 (down to 3). So a coach who holds loads is asked less, and one who always progresses is asked sooner.
- It is shown on the coach's screen as "I'll ask after N sessions. Change" so it is never a hidden rule.

## The optional note to the client (the coach decides, nothing goes by default)

Under **Show me options** there is an optional **"Draft a note to {name}"**. It writes a short, warm status note **in the coach's own voice** for the coach to edit and send with one tap. If the coach does not tap it, the client sees nothing.

It explains why progress is or is not showing even when the numbers have not changed, for example:

> Everything is going well. Your numbers are holding, and that is fine because the same weight at lower effort means you are getting stronger. We'll go up when it feels like a 6 or 7. If you'd like a call this week, tap below. If I feel we should talk, I'll reach out first.

For an **online** client this can replace a routine check-in, which is the real value. It never says "stalled", "plateau" or "stuck", and never blames.

It plugs into what already exists, nothing new:

- **Where it is delivered:** the existing message thread with the coach (the same drafted-message path the expiry and inactive cards use: the draft opens in the message box for the coach to edit). Version two can also show it as a line on the post-workout card; not needed first.
- **"Ask for a quick chat"** (a button in the note): creates a **booking request** through the existing request-and-confirm flow, or just a message to the coach if booking requests are off.
- **"Suggest a time"** (coach side, when the coach feels a meeting is needed): offers the coach's open slots through the same request flow, so the client taps one.
- **The wording** reuses the quiet-client nudge templates and the weekly check-in's voice, so a coach's tone settings apply.

## What needs building (after the release and paste queue)

- A pure function `progressLook(points, programTargets, coachThreshold, hasEffort)` and tests, like the matched-load watcher.
- A gather step on Home for the coach's clients (the same queries the matched-load watcher already makes).
- The collapsed "N need a look" row and the card, reusing the quiet card layout.
- The options panel, writing only through the existing personal-program edits.
- The optional note draft and its two buttons, wired to the existing message and request flows.
- No migration. Assistant reviews the TypeScript.

## Answered by Ron (Oct 6)

1. Main lifts: the coach marks them (tier A and B by default); the card points at the workout; accessories get a delayed, separate card.
2. No effort logged: assume the client is working hard; use "same load and reps for N sessions"; never skip these clients.
3. Limit: one collapsed row ("N need a look", up to 6 or more), expanding to at most 3 cards, oldest evidence first.
4. Client note: optional, drafted in the coach's voice, sent only if the coach wants; online clients benefit most; reuse the check-in machinery.
5. Numbers are rough guidelines the coach can change, never rules; the broad suggestion is "some form of progress".
