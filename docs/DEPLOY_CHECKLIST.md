# Deploy day: the order, in plain language

Status as of Oct 5, 7:39pm PT: **everything through migration 0269 is applied, and head 981ee51 is deployed** (Vercel deployment 6f0zm3hu2, health ok). The sections below are the order that was followed, kept as the template for the next deploy.

## 1. Before a deploy: pastes in the Supabase SQL editor (Ron)

For each migration file: paste the read-only precheck first, every row must say ok = true, then paste the apply file. If anything shows red: run `rollback;`, copy the red text, send it to Spot, do not retry. `supabase/apply/README.md` lists what is applied and what is left. After the last paste run `record-history-applied.sql`.

## 2. Vercel settings (Ron)

In Vercel, project `enduring-strength-collective`, Settings, Environment Variables (Production):

- `NEXT_PUBLIC_SUPPORT_EMAIL`: the address people write to for help and privacy questions. **Baked in when the site is built.** Not set yet (the legal pages say a contact address is being added).
- `NEXT_PUBLIC_APP_URL`: the address the site really lives at. Optional; it matters for printed QR decals.
- `VAPID_SUBJECT`: `mailto:` plus your own contact email.
- `BREVO_API_KEY` and `BREVO_FROM_EMAIL` (optional `BREVO_FROM_NAME`): leave unset to keep email and public booking closed.

## 3. Push and deploy (Claude does this on Ron's own typed word)

Claude re-runs the type check, the tests and the production build; pushes to the main branch; deploys to the right Vercel project; and confirms the new Production deployment says Ready and `/api/health` says ok. Claude does not apply migrations.

## 4. Must be off at launch

- **Public booking page (/book/name)** stays closed until the email sender is set.
- **/find-a-coach** shows no organizations until each owner switches listing on.

## 5. After a deploy: try these on your phone

See the "what Ron should try" line for the batch in `docs/OVERNIGHT_FIXED_oct6.md`.

---

# Engineering checklist (every deploy)

Push and deploy only on Ron's own word. Before each deploy:

1. **Code**: `npx tsc --noEmit`, `npm test`, then `rm -rf .next && npm run build` (not tsc alone). `npm run test:sql` for anything that touches the database.
2. **Right project**: deploy to the Vercel project `enduring-strength-collective` under the spotlightcoach team (a worktree deploy once hit the wrong project; the a3 worktree's `.vercel/project.json` points at the right one). After deploying, `vercel ls` should show the new Production deployment, Ready.
3. **Migrations first or tolerated**: the app tolerates a migration not being applied yet, but check `supabase/apply/README.md` for what is applied and what the code you are deploying needs. `record-history-applied.sql` keeps the migration history honest.
4. **Environment variables** (Vercel, then redeploy; `NEXT_PUBLIC_*` are baked in at build time, so a change needs a new build): `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `VAPID_SUBJECT` (a real mailto:), email sender and Supabase SMTP, Stripe keys and webhook, `CRON_SECRET`.
5. **Things that change what people see when this deploys** (intended, tell anyone who asks):
   - **/find-a-coach**: since migration 0256, an organization is listed publicly only after its owner or admin switches listing on.
   - Clients who are signed in on a placeholder address are sent back to "choose your password" from any group page.
   - Client screens say "sessions" where they said "credits".
   - Everyone signed in is asked once to accept the beta notice, terms and privacy policy (a version bump in lib/legal.ts asks again).
6. **After deploying**: open the live site signed in as the sandbox coach and as the sandbox client; check Home, the calendar and one booking; `/api/health` says ok.
