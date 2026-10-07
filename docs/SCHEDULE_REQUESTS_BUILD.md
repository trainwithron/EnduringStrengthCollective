# Schedule requests (pause, freeze, cancel): what is built (Release L, step 42, migration 0297)

Approved plan (Spot, Oct 7; supersedes the older `SCHEDULE_REQUESTS_DESIGN.md` flow where they differ): a client ASKS; the change applies on the date they chose; the coach
can message, mark handled, or press Done on a request dated today or earlier; there is no decline button.

## Meaning of the dates
- `effective_on` is the LAST day the schedule still runs. The change applies once that day has ended in the schedule's own time zone (`recurring_booking_series.timezone`, else the
  coach's, else New York). A coach pressing Done on or before that day counts as "processed early" and the client is told so. A coach cannot press Done on a future-dated request.
- `resume_on` (freeze only) is the first day back, at most 84 days after `effective_on`.

## Phases
1. (this commit) migration 0297, the functions, rehearsal (`scripts/sql-tests/rehearsal/0297.test.mjs`), paste file `apply-release-l-all.sql`, undo, README, paste test.
2. cron + drafts: daily run claims due requests (`claim_due_schedule_requests`), applies them with the existing `pauseSeries` / `endSeries` and the service-role store, records the result
   (`finish_schedule_request`); restarts freezes on their day (`claim_due_freeze_resumes` then `resumeSeries`, `end_schedule_freeze`, `note_schedule_resumed`, `fail_freeze_resume`);
   `lib/schedule-request-drafts.ts` for the coach's message drafts (no money wording).
3. client "My schedule" page, bottom sheet, status, Home card.
4. coach cards in Needs your decision, the profile state line, nudges.
5. Ask Spot: read-only "show their schedule requests".

## What the database does and does not do
- The engine (TypeScript) changes the schedule; the database hands out work (claim), records the result (finish) and keeps the rules (who may ask, one open request per schedule,
  three a day, date limits, private note).
- The private note lives in `schedule_request_notes` (coach/org-admin read only); it is never copied into a notification, push, log or AI call.
- Credit clock: a freeze sets the existing expiry hold (0280) to expiry + planned length at the start; a freeze that ends late adds the extra days. No existing function is replaced.
