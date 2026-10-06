# Paste files: status and order

Each step has two files: `apply-stepNN-...-precheck.sql` (read-only, every row must say ok = true) and `apply-stepNN-....sql` (all or nothing). Run the precheck, then the apply file. On any error: run `rollback;` once, copy the red text, send it to Spot, do not retry.

## Already applied. NEVER re-run these.

0264, 0265, 0266, 0253, 0248, 0267 (the files in `supabase/`), and steps 01 to 11 (0236, 0249, 0250, 0254, 0240, 0241, 0244, 0255 to 0263, 0251, 0252, 0237, 0242, 0238, 0268, 0269), applied by hand after passing every precheck, plus `record-history-applied.sql`. Steps 07 to 09 were confirmed live on Oct 5 by a read-only check of the database; 10, 11 and the history file were applied by Ron and verified afterwards.

Re-running is refused by a guard at the top of each file (it raises before changing anything), but do not rely on it. Why it matters most for `apply-0248.sql`: it replaces `complete_workout_session`, so running it again would silently undo 0236's protection against a double Finish; its first statement checks that the live function is still the 0248 version and refuses otherwise. 0258, 0261, 0262 and 0263 are plain create-table/policy files: a second run would only error, but never re-paste them. (0264, 0265, 0266, 0267, 0253 are re-runnable by design; if you re-run 0266 run 0267 again straight after, because 0266 re-creates the guards without the audit logging.)

## Still to run

Nothing. Every migration through 0269 is applied.

## Migration history (not applied yet)

None of 0236 to 0267 is recorded in `supabase_migrations.schema_migrations` (the newest row is 0247), so `supabase db push` and the dashboard's migration list show them as unapplied. `record-history-applied.sql` inserts the missing rows. It only records a migration whose change is really in the database (each has a check), skips rows already there, and can be run again after steps 07 to 09 to add those. It is safe to run any time; it changes no tables, only the history list. Run it once the remaining steps are done (or now and again later).

Regenerate everything with `node scripts/build-paste-files.mjs`; `node scripts/sql-tests/paste-files.test.mjs` applies the whole sequence on the live-equivalent schema, including the guards, the history file and the undo.
