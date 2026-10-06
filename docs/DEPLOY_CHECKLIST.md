# Deploy checklist

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
