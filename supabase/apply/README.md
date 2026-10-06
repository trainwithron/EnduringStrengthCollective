# Paste files: status and order

Each step has two files: `apply-stepNN-...-precheck.sql` (read-only, every row must say ok = true) and `apply-stepNN-....sql` (all or nothing). Run the precheck, then the apply file. On any error: run `rollback;` once, copy the red text, send it to Spot, do not retry.

## Already applied. NEVER re-run these.

0264, 0265, 0266, 0253, 0248, 0267 (the files in `supabase/`), and steps 01 to 11 (0236, 0249, 0250, 0254, 0240, 0241, 0244, 0255 to 0263, 0251, 0252, 0237, 0242, 0238, 0268, 0269), applied by hand after passing every precheck, plus `record-history-applied.sql`. Applied by Ron on Oct 6 and checked read-only on the live database: step 12 (0270), step 14 (0273), step 15 (0274), step 16 (0275) and step 18 (0276). (A second paste of step 18 hit its own guard; harmless.) Steps 07 to 09 were confirmed live on Oct 5 by a read-only check of the database; 10, 11 and the history file were applied by Ron and verified afterwards.

Re-running is refused by a guard at the top of each file (it raises before changing anything), but do not rely on it. Why it matters most for `apply-0248.sql`: it replaces `complete_workout_session`, so running it again would silently undo 0236's protection against a double Finish; its first statement checks that the live function is still the 0248 version and refuses otherwise. 0258, 0261, 0262 and 0263 are plain create-table/policy files: a second run would only error, but never re-paste them. (0264, 0265, 0266, 0267, 0253 are re-runnable by design; if you re-run 0266 run 0267 again straight after, because 0266 re-creates the guards without the audit logging.)

## Still to run

In this order:
1. **Step 13 (0271)**, function permissions. Paste `check-step13-probe.sql` first (baseline: anon_can_run = true), then step 13, then the probe again (must show anon_can_run = false). The probe creates a throwaway function inside one transaction and rolls it back, so it needs no test project and leaves nothing behind.
2. Deploy the care batch (code).
3. **Step 17 (0272)**, only after the care deploy and step 13.
4. `record-history-applied.sql` again (see below).

### New (Oct 6), built but NOT applied, review by the Assistant first

- **Step 19 (0277)**: a client's late cancel or late move is FLAGGED for the coach to Charge or Waive; nothing is taken automatically. Replaces `cancel_booking_and_refund_credit` and `reschedule_booking` (the precheck and the guard refuse unless the live functions are exactly the versions it was built from, by md5), adds `resolve_late_change`, two bookings columns and the `late_change` notice type. Undo restores the old functions. Deploy order: the code that shows Needs your decision (this branch) can go first; until the step is applied the panel stays empty.
- **Step 20 (0278)**: clients can book themselves only if the coach switches it on (per coach, off by default). Replaces `book_session` (md5-guarded). Undo restores the old function and removes the column. IMPORTANT order: apply step 20 and the code together; if the step is applied first, clients simply cannot book until a coach switches it on, which is the intent. If the code is deployed first, nothing changes until the step is applied.

- **Step 21 (0279)**: with self-booking off, a client asks to move a session and the session stays put until the coach confirms (Confirm or Decline under Needs your decision; the client is told either way). Adds `booking_move_requests`, `request_booking_move`, `resolve_move_request`, and replaces `reschedule_booking` (md5-guarded against the step 19 version) so a client cannot move directly while self-booking is off. Needs steps 19 and 20 first. Undo restores the step 19 `reschedule_booking` and removes the request table.
- Notes: a coach who is also their own client (a self-coach account) counts as a client of themselves and needs self-booking switched on for their own account. Steps 19 and 20 also cover the weekly-schedule and waiting-list functions; a coach confirming a move inside the window gets the same Charge or Waive flag as a direct late move.

## Migration history (needs a re-run)

None of 0236 to 0267 is recorded in `supabase_migrations.schema_migrations` (the newest row is 0247), so `supabase db push` and the dashboard's migration list show them as unapplied. `record-history-applied.sql` inserts the missing rows. It only records a migration whose change is really in the database (each has a check), skips rows already there, and can be run again after steps 07 to 09 to add those. It is safe to run any time; it changes no tables, only the history list. Run it again now that 0270, 0273, 0274, 0275 and 0276 are live (it records those; 0271 and 0272 stay unrecorded until they are applied), and once more after steps 13 and 17.

Regenerate everything with `node scripts/build-paste-files.mjs`; `node scripts/sql-tests/paste-files.test.mjs` applies the whole sequence on the live-equivalent schema, including the guards, the history file and the undo.
