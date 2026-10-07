# Pause, freeze and cancel a client's weekly schedule: design (Oct 7)

Status: design only. Nothing built. Scoped with Ron by Spot Commander (Oct 7). Assistant reviewed it (Oct 7); the changes it asked for are folded in below (marked REVIEW). Builds after Ron's go. No push.

## What Ron asked for (his words, via Spot)

A client's recurring weekly schedule can be **paused**, **frozen** or **cancelled**. The coach controls it, but it is **easy for the client to ask**. The client app has one obvious place ("My schedule") with three buttons and a one-tap sheet each, an optional note, and a plain status after. The coach sees each request in **Needs your decision** with a short, caring, drafted reply (the coach edits and sends; never automatic) and buttons Confirm / Talk first / Decline with a note. The coach can also start any of the three from the client profile ("Their schedule: Active / Paused / Frozen until <date>") and through Ask Spot ("pause Johann's schedule", with a confirm card). A request left more than about 2 days nudges the coach, and the client sees "your coach hasn't replied yet" with a one-tap "message my coach". Billing (Stripe) is off today, so v1 covers the schedule only, built so the same three states can later drive a payment subscription.

## The three states (exact meaning)

| State | Meaning | Schedule effect | Balance |
|---|---|---|---|
| Pause | Indefinite, until resumed | Series stops topping up; future unsettled sessions come off the calendar (the existing `pauseSeries`: cancels future sessions, remembers how many were removed) | Untouched |
| Freeze | Temporary, with a resume date | Same as pause now, plus `frozen_until`; a daily job resumes it on that date (the existing `resumeSeries`) | Untouched |
| Cancel | Permanent | Series ended, future booked sessions cancelled under the normal rules (the existing `endSeries`); history kept | Untouched (the normal expiry rules apply) |

"Under the normal rules" means exactly what `cancelFuture` does today: a session already happened or marked attended is history and is never touched; the others go through `cancel_booking_and_refund_credit` (so a prepaid session is refunded, an unsettled one just leaves the calendar). Nothing here takes a credit.

## What already exists and is reused

- `lib/series-engine.ts`: `pauseSeries`, `resumeSeries`, `endSeries`, `topUpSeries`; `recurring_booking_series` already has `status` (active, paused, ended, cancelled), `paused_at`, `paused_remaining`, `ends_on`. The coach's `ClientSeriesPanel` on the profile already offers these buttons.
- `booking_requests` + `resolve_booking_request` + the `LateChangesPanel` ("Needs your decision"): the pattern for a client asking and the coach deciding, with a status the client can read and a notification both ways. This design copies the pattern into one new table rather than stretching `booking_requests` (its columns are about slots and times).
- The message-draft path: `/groups/{id}/messages/{athleteId}?draft=...` (used by the come-back draft in `calendar-spotter-panel.tsx`; `lib/attendance-draft.ts` is the model for a drafted note).
- Notifications (`notifications` table, type check list, push via `notifyPush`), the Ask Spot action layer (`lib/assistant-actions.ts`: propose, signed confirm, undo; the pattern for "pause Johann's schedule"), the audit trigger style (`audit_watch`), the Spotter card style, the daily cron pattern (`withCronRun`).

## Data

One new table, `schedule_requests` (written only through functions, like `booking_requests`):

```
id, series_id (the schedule it is about), athlete_id, coach_id, group_id,
kind            'pause' | 'freeze' | 'cancel'
freeze_until    date, only for 'freeze' (the day the schedule resumes; at most 12 weeks out in v1)
note            text, the client's optional words (max 500), shown to the coach only
status          'pending' | 'talk_first' | 'confirming' | 'confirmed' | 'declined' | 'withdrawn'
                (REVIEW: 'confirming' is the short claimed state while the schedule is being changed; see the confirm order)
requested_by    'client' | 'coach'   (a coach-started change is stored as already 'confirmed', for one history)
created_at, decided_at, decided_by, decision_note (coach's note to the client, max 500)
reminded_at     when the 2-day nudge was sent (once)
resume_notified_at  when the "resumes soon" heads-up was sent (freeze only)
effect_at       nullable and unused in v1 (null = takes effect at the decision). Kept only as the seam for billing: see "Cancel and the law"
```
And on `recurring_booking_series`: `frozen_until date` (null unless frozen) and `paused_by text` ('coach' | 'client_request') for the profile line. REVIEW: a partial unique index allows ONE OPEN request per series, where open means status in ('pending', 'talk_first', 'confirming'), so a second request cannot be started while the first is in "talk first" or being applied. A client can make at most 5 requests a week and one a day; a re-request within 24 hours of a decline does not notify the coach again unless the note changed. `status` of the series stays the source of truth for "Active / Paused / Frozen until".

Notification types added: `schedule_request` (to the coach), `schedule_request_decision` (to the client), `schedule_request_waiting` (the 2-day nudge, coach), `schedule_resume_soon` (coach heads-up before a freeze ends).

## Functions (all security definer, caller-checked, service role for the cron ones)

- `request_schedule_change(series_id, kind, freeze_until, note)`: the client only, only for their own active (or, for cancel, active or paused) series; refuses if one is pending; validates the freeze date; notifies the coach. Rate limited (one request per series per day).
- `withdraw_schedule_request(request_id)`: the client takes back a pending one.
- `claim_schedule_request(request_id, expected_status)` and `finish_schedule_request(request_id, result)` (REVIEW): the two short database steps around the app's server step (see the confirm order). `decline` and `talk_first` are one function, `decide_schedule_request(request_id, decision, decision_note)`: it only records and notifies (a `talk_first` keeps the request open, marked "you're talking with your coach"; it becomes confirmed or declined later). Who may decide, everywhere: the group's CURRENT coaches or an org owner/admin (not `series.coach_id`, which can be stale after a reassignment).
- **The confirm order (REVIEW)**. The route `/api/series/schedule-change` is the single entry; a database function cannot call the app, so the order is what keeps it safe: (1) the route verifies the caller is one of the group's current coaches or an org owner/admin; (2) `claim_schedule_request` sets the status to 'confirming' with a compare-and-set (from 'pending' or 'talk_first'; a double tap, a second coach, or the client withdrawing at the same moment loses and gets "already being handled"); (3) it re-checks the series (still the right status for the kind; a freeze date still in the future in the SERIES' timezone, otherwise it stops and asks the coach for a new date, nothing changed) and runs the engine with the **service-role store**; (4) `finish_schedule_request` records 'confirmed' with decided_at and decided_by, or, if the engine returned an error, puts the request back to its earlier status with the error shown to the coach. A crash between 3 and 4 leaves the request in 'confirming' with the series already changed; the route and the coach's card treat 'confirming' older than 2 minutes as "finish recording" (one tap, it checks the series state and records it), so a request is never left asking again about a schedule that is already paused.
- **Credit effects (REVIEW)**. The engine MUST run with the service-role store after the route has verified the coach, never with a client's session: `cancel_booking_and_refund_credit` under a client session flags a late cancel and refunds, while under the service role it takes the coach-style branch (always refunds a prepaid or settled session, never flags). That is what makes "nothing here takes a credit and nothing is flagged against the client" true. Pausing or freezing refunds only credits already taken for a removed session (a self-booked prepaid one). Resuming (auto or by the coach) books the whole window again through `book_session`, which for a client-paid session takes the credit again: correct, and shown to the coach as "Resumed: N sessions booked (N credits used)". Never worded to the client as "balance untouched".
- If the engine reports sessions it could not remove, the request is still confirmed and the card and the client notification say how many stay on the calendar (REVIEW: for a freeze they stay through the freeze, and the resume heads-up repeats the count). A session that already started and is still unmarked stays too (the existing rule) and is named in the result ("1 session today stays").
- `start_schedule_change(series_id, kind, freeze_until)`: the coach starting any of the three from the profile or Ask Spot (same server step, stored as a confirmed request with `requested_by = 'coach'`).
- Cron `schedule-resume` (daily, run before `series-top-up`) (REVIEW, hardened): it CLAIMS each series with one statement, `update recurring_booking_series set status = 'active' ... where status = 'paused' and frozen_until <= today returning`, so it and the top-up job can never both act on one series; it then runs `resumeSeries`. When resuming fails (an older schedule with no anchor date, or dates that could not be booked) it records the failure on the request, leaves `frozen_until` as it was, tells the coach once and again after 3 days with the list ("these dates could not be booked"), never retries in a loop, and the run is marked failed in the job monitor when every resume failed. It also sends the "resumes in 3 days" heads-up once (`resume_notified_at`) and the 2-day nudge for any request still open after 48 hours (coach; flips what the client sees). Manual Resume and End clear `frozen_until` and `paused_by`, so the profile line never says "Frozen until" for an active series. It writes a `cron_runs` row like every job.

## The client's side: "My schedule"

A single page, `/groups/{groupId}/my-schedule`, reached from Home ("My schedule" card, only for a client with a weekly schedule) and from the Calendar. It shows, in plain words: the schedule ("Tuesdays at 6:00 AM, 60 minutes"), its state ("Active", "Paused", "Frozen until Nov 3"), the next session, and three buttons:

- **Request a pause**, **Request a freeze** (choose how long: 1, 2, 4, 8 weeks, or pick a date), **Request to cancel**.
- Each opens a one-tap bottom sheet: one sentence of what happens ("Your sessions come off the calendar. Your remaining sessions stay yours."), an optional note ("What's going on?"), and one primary button. No second confirm screen; the sheet itself says "Your coach will reach out".
- After sending: "Request sent Oct 8. Your coach will reach out." plus the status (Waiting / Your coach is checking in / Confirmed / Declined with their note). A pending request can be withdrawn. After about 2 days unanswered it reads "Your coach hasn't replied yet" with a one-tap **Message my coach** (opens their messages).
- Never worded around money or credits to a client. The client never sees "owed". Cancel keeps the warm tone: "Sorry to see you go. Your coach will be in touch."

Mobile first (the client is on a phone), 44 px targets, sentence case, red only for the one main action.

## The coach's side

1. **Needs your decision** (the existing panel) gains a card per request: "{Client} asked to pause their weekly schedule (Tuesdays 6:00 AM)", their note in quotes, where their balance stands, in one plain line (REVIEW: for a cancel or a long freeze the line names the paid sessions they still have and when those expire, for example "6 sessions left; they expire Jan 3", so the coach chooses what to do about them: a refund, an extension, or nothing; nothing is done automatically), a **drafted reply** in an editable box (a short, caring, specific draft per kind, in the style of `buildComeBackDraft`: no guilt, no money; the coach edits it; "Send" posts it as a normal message to the client and records the decision; nothing is ever sent without the coach pressing Send), and the buttons **Confirm** (do it and send the reply), **Talk first** (opens messages with the draft; the request stays open), **Decline with a note** (asks for a one-line reason; sends it).
2. **Client profile**: the line "Their schedule: Active / Paused / Frozen until Nov 3 / Cancelled" at the top of the weekly-schedule section, with the three actions available to the coach directly (a freeze asks for a date; cancel asks one confirm). A coach-started change does not ask the client; it notifies them ("Your coach paused your weekly schedule").
3. **Ask Spot**: three new actions in the existing propose/confirm/undo layer ("pause Johann's schedule", "freeze Johann until Nov 3", "cancel Johann's schedule"): the card names the client, the schedule, how many sessions leave the calendar, and asks one confirm. Undo is offered for pause and freeze (resume), not for cancel (it says so on the card).
4. **Nudges**: the 2-day nudge as a Needs-your-decision badge plus one push (not repeated). A freeze that ends in 3 days: a heads-up with an optional drafted welcome-back note.

## Edge cases and decisions

- A client with more than one schedule: the sheet asks which first ("Tuesdays 6:00 AM" / "Thursdays 5:00 PM"), or "all of them", which creates one request per schedule that the coach decides one at a time (REVIEW: not "decided together", because one could succeed and another fail).
- Pausing while a session is inside the cancellation window or already happened: sessions that already happened are untouched (existing rule); the next one inside the window is removed with the normal refund-or-flag rule of `cancel_booking_and_refund_credit`, so a late removal made BY THE COACH never flags the client. Because the coach confirms, the coach is the one cancelling.
- Resume of a paused schedule is the coach's (the existing Resume button); a client may ask to resume with the same sheet ("Request to restart"), v1.1.
- Freeze that cannot rebook cleanly at the end (the old times are taken): the same "these dates could not be booked" list the Resume button returns, shown to the coach in the heads-up.
- A coach who does not answer: nothing happens automatically (never an auto-confirm). The client is told, can message, and can withdraw.
- Group-class attendees, session packs without a series, and clients with no series: not covered; the screen is hidden when there is no series.
- Concurrency: one pending request per series (unique index); the decide function locks the request row; the schedule change is idempotent (pausing a paused series is refused with a clear message).
- Privacy (REVIEW): the note can be very personal ("my husband died", an injury). It is visible only to the client and the group's coaches and org admins (RLS: the client reads their own requests, coaches read their group's; no direct write policy). It never goes into a push or SMS (those say "Maria sent a schedule request"), a log line, an audit row's text, an AI call (the drafted replies are fixed builders that never read the note), or a Zapier/webhook payload. It is added to the retention and deletion lists.
- Audit: the decision is a row in `schedule_requests` (who, when, what, the note); series status changes already go through the series engine. An `audit_watch` trigger on the table records any later edit.

## Billing later (built in now, switched on later)

The three kinds map one to one to a subscription: pause = Stripe `pause_collection`, freeze = `pause_collection` with `resumes_at`, cancel = `cancel_at_period_end` or immediate. The decision step is one function (`apply_schedule_change`) with two effects (schedule, subscription) so adding the second changes no screen. Billing stays off in v1.

**Cancel and the law** (Spot flagged for the lawyer list): paid auto-renewing subscriptions may require cancelling to be as easy as signing up in some jurisdictions, so before billing goes on, a coach-must-approve cancel needs a legal check. REVIEW: v1 has NO setting and NO job that makes a cancel take effect without the coach (that would contradict "the coach decides" and needs the lawyer first). The only seam is the nullable `effect_at` column, unused (null = at the decision); a later "takes effect at period end" mode, if legal asks for it, is added in the same step as its own setting and job, not before.

## Build order (each step small, tested, reviewed)

1. Migration `0293` (one step in a release bundle): `schedule_requests`, the series columns (`frozen_until`, `paused_by`), the notification types, the claim/finish/decide/request/withdraw functions, RLS, audit trigger, undo and rehearsal (a client can ask only for their own series; only the group's current coaches decide; one OPEN request per series including 'talk_first' and 'confirming'; weekly cap; freeze date limits; claim is compare-and-set so a double confirm or a withdraw race loses; decline/talk-first change nothing).
2. Server: `/api/series/schedule-change` (confirm path) + the drafted-reply builders (`lib/schedule-request-drafts.ts`, tested like the other draft helpers) + the `schedule-resume` cron.
3. Client "My schedule" page, sheet, status, and the Home card.
4. Coach: Needs-your-decision cards, the profile line and actions, nudges.
5. Ask Spot actions.
6. Billing hook left as a documented seam (no code).

Tests: engine-level (pause/freeze/cancel through the existing fake store: sessions removed, history kept, balance untouched), draft builders (wording rules: no money, no guilt, first name), cron (resume on the day, heads-up once, nudge once), SQL rehearsal for the permissions, and unit tests for the "state line" shown on both sides.

## Open questions for Ron (answer when convenient; defaults in brackets)

1. Longest freeze a client may ask for [12 weeks; the coach can set any date themselves].
2. Should a coach's reply be required when declining [yes, one line].
3. Does a paused or frozen client still get the session reminders for sessions that remain [no: nothing remains by definition].
4. After a cancel, should the client keep seeing their old schedule in history [yes, as "Ended Nov 3"].
