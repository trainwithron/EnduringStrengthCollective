# Deploy day: the order, in plain language

Checked against the live database on Oct 5 (read-only): migrations 0237, 0238, 0242 and 0252 are already applied. **0268 and 0269 are not applied yet.** Nothing after 0269 exists.

## 1. Before the deploy: two pastes in the Supabase SQL editor (Ron)

Do them in this order. For each: paste the precheck first, every row must say ok = true, then paste the apply file. If anything shows red: run `rollback;`, copy the red text, send it to Spot, do not retry.

1. `supabase/apply/apply-step10-0268-precheck.sql`, then `supabase/apply/apply-step10-0268.sql` (security fixes for session and workout writes, and audit-log redaction).
2. `supabase/apply/apply-step11-0269-precheck.sql`, then `supabase/apply/apply-step11-0269.sql` (small-group session fixes).

Both work with the code that is live today, so they are safe to do first. (If the exact file names differ, the folder README `supabase/apply/README.md` lists them.)

## 2. Vercel settings (Ron), then tell Claude

In Vercel, project `enduring-strength-collective`, Settings, Environment Variables (Production):

- `NEXT_PUBLIC_SUPPORT_EMAIL`: the address people write to for help and privacy questions. **Baked in when the site is built**, so it must be set before the deploy, not after.
- `NEXT_PUBLIC_APP_URL`: the address the site really lives at (used in links in emails and texts).
- `VAPID_SUBJECT`: `mailto:` plus your own contact email (identifies you to the push services).
- Leave `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` **unset for now**: that is what keeps public booking closed (section 4).
- Already set and unchanged: Supabase keys, `CRON_SECRET`, Stripe keys if you use them.

## 3. Push and deploy (Claude does this on Ron's own word)

Typing "push and deploy" in the Claude window that holds this work is enough, once sections 1 and 2 are done. Claude will: re-run the type check, the tests and the production build; merge to the main branch; push; deploy to the right Vercel project (`enduring-strength-collective`, the spotlightcoach team); and confirm the new Production deployment says Ready and `/api/health` says ok. Claude will not apply migrations for you.

## 4. Must be off at launch

- **Public booking page (/book/<name>)**: stays closed by itself until the email sender (SendGrid values above) is set. A visitor sees "This booking page isn't available". Do not set the SendGrid values until you want it on, and test it yourself first.
- **/find-a-coach** shows no organizations until each owner switches listing on (intended).

## 5. After the deploy: try these on your phone (5 minutes)

1. Sign in as the coach. Home shows **Quick actions** (Add a client, All clients, Programs, Calendar) and the bottom tabs. Tap Clients, then **Add client**: the default is "A one-on-one client", not a group.
2. Open any page you should not have access to (for example a coach page while signed in as a client): it shows a **Go to Home** button.
3. Add a test client by invite link, open the link in a **different browser**, create the account, confirm the email. If the confirm screen says "wrong address?", try that link. The first time they sign in they get a short "One quick thing" terms screen, then the intake.
4. As that client: Home, start a workout, finish it, check it shows once.
5. Home, "Needs attention": it is one line you can open, has Dismiss all, and the brand new client is not listed in it.

If something looks wrong, tell Spot what you tapped and what you saw.

---

# Engineering checklist (every deploy)

Push and deploy only on Ron's own word. Before each deploy:

1. **Code**: `npx tsc --noEmit`, `npm test`, then `rm -rf .next && npm run build` (not tsc alone). `npm run test:sql` for anything that touches the database.
2. **Right project**: deploy from the main checkout to the Vercel project `enduring-strength-collective` under the spotlightcoach team (a worktree deploy once hit the wrong project). After deploying, `vercel ls` should show the new Production deployment, Ready.
3. **Migrations first or tolerated**: the app tolerates a migration not being applied yet, but check `supabase/apply/README.md` for what is applied and what the code you are deploying needs. `record-history-applied.sql` keeps the migration history honest.
4. **Environment variables** (Vercel, then redeploy; `NEXT_PUBLIC_*` are baked in at build time, so a change needs a new build): `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `VAPID_SUBJECT` (a real mailto:), email sender and Supabase SMTP, Stripe keys and webhook, `CRON_SECRET`.
5. **Things that change what people see when this deploys** (intended, tell anyone who asks):
   - **/find-a-coach**: since migration 0256, an organization is listed publicly only after its owner or admin switches listing on. Every organization starts off, so when the newer code that reads this is deployed, all organizations disappear from /find-a-coach until each one opts in.
   - Clients who are signed in on a placeholder address are sent back to "choose your password" from any group page.
   - Client screens say "sessions" where they said "credits".
6. **After deploying**: open the live site signed in as the sandbox coach and as the sandbox client; check Home, the calendar and one booking; `/api/health` says ok.
