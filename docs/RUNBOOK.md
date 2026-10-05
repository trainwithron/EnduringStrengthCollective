# Runbook

What to do when something goes wrong, written for one person under pressure. Keep it short; fix the doc when reality differs.

Facts this relies on:
- The app runs on Vercel. **A push to the repository does not deploy it**; a deploy is a deliberate `vercel --prod` (or the Vercel dashboard).
- The database, auth and file storage are one Supabase project. **Development and production share it.** There is no staging database.
- Migrations are plain SQL files in `supabase/migrations/`. There are no automatic "down" migrations. `supabase/MIGRATION_MAP.md` says which are applied.
- Money moves through Stripe. Texts go through Twilio, email through SendGrid, AI through Anthropic, video through Daily.

## 1. First five minutes: triage

1. **Is it everyone or one person?** One person: ask what they did and what they saw; open their account as a coach (View as client) and try it. Everyone: go on.
2. **Check the health route**: open `/api/health`. If it is not "ok", note what it says.
3. **Check the three dashboards**: Vercel (latest deployment and its logs, "Runtime Logs" for errors), Supabase (Logs, then the project status page), Stripe (Developers, then Webhooks for failed deliveries).
4. **Did something just change?** The last deploy and the last migration are the usual causes. If the problem started right after one, go to section 2 or 3.
5. **Tell people** (a short note to testers or clients) if it will last more than a few minutes. Say what is wrong and when you will look again, not why.
6. **Write down** what you saw, when, and what you did. You will want it later.

## 2. Roll back a bad deploy

The site is a set of immutable deployments, so going back is quick and does not touch data.

1. Vercel dashboard, then the project, then **Deployments**.
2. Find the last good deployment (the one before the problem). Open its menu and choose **Promote to Production** (or from a terminal: `vercel rollback`).
3. Confirm the site works. Cron jobs and environment variables stay as configured.
4. Do not "fix forward" under pressure unless the cause is obvious and tiny.

A rollback does **not** undo database changes. If the bad deploy depended on a migration, the old code usually still works with the new columns (new columns are added, not removed), but check.

## 3. A bad migration

First, stop applying more of them.

1. **See what ran**: Supabase, SQL editor, `select version, name from supabase_migrations.schema_migrations order by version desc limit 10;`, and compare with `supabase/MIGRATION_MAP.md`.
2. **Is it breaking things now?** Check the Supabase logs and the app. If yes, decide between repairing forward and restoring (section 6). Repairing forward is almost always faster.
3. **Repair forward**: write a new migration that fixes it. Most migrations here add columns, tables, policies or functions, so the repair is usually `drop policy`, `drop function`, or `alter table ... drop column` for the thing just added. Review the migration file you applied; it lists exactly what it changed.
4. **If data was lost or changed wrongly**, use the backup (section 5) to recover just those rows rather than restoring everything.
5. Never edit an applied migration file to "fix" history. Add a new file and update `supabase/live-migrations.txt` plus `node scripts/migration-map.mjs`.

Before applying a batch, rehearse it: `node scripts/sql-tests/rehearsal.mjs` builds a copy of the live schema in memory, applies the pending migrations one at a time in the planned order, and runs a behaviour test for each (who can read or write what, what a lockout does, what a refund returns). It writes `supabase/REHEARSAL.md`, a table of which migrations applied cleanly and which have behaviour proven. When you add a migration, add it to `PLAN_ORDER` in `scripts/sql-tests/harness.mjs` and write its test in `scripts/sql-tests/rehearsal/`. It does not use real data or real Supabase Auth, so it proves the SQL, not the production database.

Migrations that need care and must be applied in the documented order: those that drop things (`0252`, `0253`) wait until the code that no longer needs them is live.

## 4. A secret has leaked

Assume the worst: someone has it. Rotate first, investigate second.

| Secret (env var) | Rotate by | Then |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Project Settings, API, regenerate the service role key | Update it in Vercel and redeploy. **This key bypasses all row security**, so treat a leak as the worst case: check Logs for unusual reads and writes. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public by design; only rotate if the project itself was compromised | Update Vercel and redeploy |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe dashboard, roll the key; roll the webhook signing secret on the endpoint | Update Vercel, redeploy, send a test event |
| `ANTHROPIC_API_KEY` | Anthropic console, create a new key and delete the old | Update Vercel, redeploy. Check usage for spikes. |
| `TWILIO_AUTH_TOKEN` | Twilio console, rotate the auth token | Update Vercel, redeploy |
| `SENDGRID_API_KEY` | SendGrid, delete the key and create a new one | Update Vercel, redeploy |
| `DAILY_API_KEY` | Daily dashboard, create a new key | Update Vercel, redeploy |
| `CRON_SECRET`, `GARMIN_WEBHOOK_SECRET` | Generate a new random value | Update Vercel (and Garmin's registration) and redeploy |
| `VAPID_PRIVATE_KEY` | New key pair | Everyone's push subscriptions stop working and must be renewed; avoid unless forced |
| OAuth client secrets (Oura, Withings, Garmin, Google) | Rotate in each provider's console | Update Vercel, redeploy; connected users may need to reconnect |

Then: check Vercel and Supabase logs for use you do not recognize, tell affected people if their data could have been read, and write down what happened. If the leak was in git history, rotating is what matters; rewriting history does not help.

## 5. Backups

`scripts/backup.mjs` copies the database (pg_dump) and every storage bucket to a folder on your machine, keeps the newest 14 dated copies, and checks the dump can be read back. It only reads from Supabase.

```
DATABASE_URL="postgresql://..." NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.mjs --out D:/spotlight-backups
```

- Needs PostgreSQL client tools (pg_dump, pg_restore) installed. `DATABASE_URL` is the connection string from Supabase, Project Settings, Database.
- **Schedule it** nightly (Windows Task Scheduler, cron, or a scheduled GitHub Action) and have the scheduler alert on a non-zero exit. A backup nobody runs is not a backup.
- Backups hold real client data. The `backups/` folder is ignored by git; keep copies on an encrypted disk and a second place off this machine.
- Supabase also keeps its own daily backups on paid plans: Project Settings, Database, Backups. Know where all your copies are before you need them.
- **Test a restore** into a scratch project once now and after any big change (section 6).

## 6. Restore into a new project

Use this when the project is lost or beyond repair.

1. Create a new Supabase project (same region).
2. **Schema**: apply `supabase/migrations/*.sql` in order against it. A full-chain test (`node scripts/sql-tests/chain.mjs`) found three files that do not apply from an empty database: `0030` (drops a policy that only exists live; use `drop policy if exists`), `0248` (rewrites `complete_workout_session` by exact live text and will stop with "credit block not found"; restore the live function definition from the dump instead) and `0251` (needs the pgcrypto extension enabled). `0049` also looks up the real owner account by email, so create that user first, or restore from the database dump instead of replaying migrations (the MIGRATION_MAP lists any fixes that were applied straight to the old database and are not saved as files; reapply those by hand).
3. **Data**: restore the latest dump from your backup (`pg_restore` or `psql`), data only, into the new database.
4. **Storage**: copy the buckets from your storage backup into the same bucket names.
5. **Auth**: users live in the database dump (`auth.users`). Confirm sign-in works and password reset emails send (section 8).
6. **Point the app at it**: update `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in Vercel and redeploy. Update the Supabase URL in the Stripe/Twilio webhooks only if they pointed at Supabase directly (they point at this app).
7. Check: sign in as a coach and an athlete, open a program, log a set, make a booking, load a share link.

## 7. Stripe reconcile

When money and the app disagree (a payment with no credits, credits with no payment):

1. Stripe dashboard, Developers, Webhooks, the app's endpoint: look for **failed deliveries** and resend them. Handling is idempotent (a repeated event does not double-grant).
2. Stripe, Payments: find the payment by customer email or amount. Its metadata names the client and the package.
3. In the app (as the coach): the client's **Session ledger** shows every change to their balance, with the reason. A purchase appears as "purchased".
4. If credits are missing and the payment is real: add them with **Assign sessions** and a note ("Stripe payment pi_..."). If a payment should be refunded, refund it in Stripe and set the balance with **Set balance** and a note.
5. Check the other direction too: credits granted with no matching payment usually mean a manual assignment, which the ledger note should explain.

## 8. Supabase Auth settings to check

Set these in Supabase, Authentication. Review them after any project change.

- **Site URL** and **Redirect URLs**: the real domain (and the localhost URL for development). A wrong value breaks email links.
- **Email confirmations**: on. Confirmation and invite emails must reach people; see below.
- **Custom SMTP**: set it. The built-in sender allows only a handful of emails an hour, which will break signup at any volume.
- **Password**: minimum length 8 or more; turn on **leaked password protection** if the plan offers it.
- **Rate limits** (Authentication, Rate Limits): leave on; raise sign-in and email limits only as needed.
- **Sign ups**: enabled (coaches self-register); there is no social login configured.
- **JWT expiry**: keep the default unless you have a reason.
- **MFA**: not used yet; consider for the platform admin account.
- **Email templates**: confirm, invite, magic link and password reset read well and carry the right link.

## 9. Contacts and places

- Vercel dashboard: the project's Deployments, Logs, Environment Variables, Cron Jobs (one daily job reports failures, see `/api/health` and the cron failure alerts).
- Supabase dashboard: SQL editor, Logs, Backups, Authentication.
- Stripe, Twilio, SendGrid, Anthropic, Daily: each provider's own status page when their calls fail.
