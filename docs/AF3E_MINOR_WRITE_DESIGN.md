# AF3 (e): the database backstop for a child's direct writes (design, no SQL yet)

## The gap
The app now stops a blocked child at the page gate and on every `/api` route (AF1). The browser can still write straight to the database with the person's own sign-in, so a child who skips the screens can still insert a post, a comment, a reaction, a message, a photo or a weight. I counted what the browser writes directly (client components calling `.from(table).insert/update/upsert/delete`): about 125 tables. Almost all are coach tools. Only a few put a child's words, picture or body on a screen another person sees.

## The rule (a mirror of `lib/dob-gate.ts`, not a new policy)
`public.minor_may_write(p_user uuid default auth.uid()) returns boolean`, security definer, stable, `search_path = public`, no side effects.

| Person | Result |
|---|---|
| No athlete seat anywhere, or any coach seat | true (a coach, or someone who is not a client) |
| Athlete seat, staff (organization role or front-desk seat), youngest date on file (intake date or profile birthday) is 18 or older, or there is no date at all | true |
| Athlete seat, staff, youngest date on file shows under 18 | falls through to the client rules below (staff status never switches off the age rules for a known minor) |
| Client, no date of birth in `client_intake` | **false** (unknown age counts as not an adult, same as the API guard) |
| Client under 13 | **false** |
| Client 13 to 17, guardian consent `signed` (`guardian_consents.status = 'signed'`) | true |
| Client 13 to 17, consent pending, expired, withdrawn or none | **false** |
| Client 18 or older with a date | true |

Age uses the calendar (`age(current_date, dob)`), the same boundaries the TypeScript uses; the rehearsal checks the birthday-eve and birthday cases on both sides of 13 and 18.

## Where it applies: restrictive policies, insert and update only
A `RESTRICTIVE` policy is ANDed with the existing ones, so nothing that is allowed today becomes more allowed, and nothing changes for anyone the function says true to. Delete is left alone (a child can always take their own content down). The service role bypasses row security, so server routes are unaffected (they are already covered by the API guard).

| Tier | Tables (the writer is `auth.uid()`) | Why |
|---|---|---|
| 1. Shows the child to other people | `posts`, `comments`, `reactions`, `direct_messages`, `exercise_video_comments`, `training_partner_profiles`, `training_partner_requests`, `challenge_participants` | words, a name or a request that another person sees |
| 2. Pictures, video and body measurements | `progress_photos`, `session_exercise_videos`, `body_weight_logs`, `body_scans`, `transformation_cards`, `transformation_milestones` | media or body data stored under the child's name |

**Deliberately not covered**
- Nutrition tables (`food_log_entries`, `daily_macros`, `meal_plans`, preferences): Ron decided minors and macros is a coach and parent decision, not an automatic exclusion. A restrictive policy there would be exactly that exclusion.
- `wellness_checkins`: a child telling their coach how they feel or that something hurts is a safety signal (decided by Commander).
- Training itself (`athlete_sessions`, `set_logs`, `session_exercises`): not social, not sensitive, and a coach logging for a child writes as the coach.
- Safety actions (`user_blocks`, reports, `support_messages`, `support_requests`): a child must always be able to ask for help or block someone.
- The birthday and health steps (`client_intake`, `athlete_profile_details`, `minor_consent`): the child has to be able to finish them to get unblocked.

## Risks and how they are handled
1. **A bug here blocks every client everywhere.** The function is a pure read with no dynamic SQL; it is tested against a matrix before any table gets a policy; and it ships in **two pastes**: paste 1 creates the function only (nothing uses it), paste 2 adds the policies on **one table (`posts`)** first. The rest follow in a third paste only after `posts` has run in production for a few days with no false blocks. Each paste has its own undo file that drops the policies.
2. **A false block on a real adult.** The likeliest cause is an adult client with no birthday on file: the page gate already sends them to the birthday screen, so they cannot reach the writes anyway. The rehearsal includes "adult client, no date" as an expected block and "staff adult, no date" as an expected pass.
3. **Cost.** One indexed lookup of the person's seats per write on the covered tables only; writes are rare compared with reads.
4. **Error behavior.** The function never raises. Any lookup that finds nothing answers by the table above (no seat means true). If the function itself is missing the policy cannot be created, so it cannot half-apply.

## Tests (rehearsal, real policies)
One person for each row of the rule table, plus: a service-role write passes; a coach writing to a child's thread passes; a child's delete passes; and every covered table is checked for both an allowed and a refused insert. A live-catalog test (like the existing reference-policy one) fails the suite if a table with a child-visible `author`-style column is added later without being listed here or on the "deliberately not covered" list.

## Decisions (approved)
1. Tier lists as written, except `wellness_checkins` stays OUT; `body_scans` stays IN.
2. Training logs OUT.
3. Staged rollout: paste A (function only, step 167), paste B (policies on `posts` only, step 168), paste C (the rest, step 169) after `posts` has run clean for a few days. Ron applies them.

## Built
Migrations 0415 (function), 0416 (posts), 0417 (rest); rehearsals 0415 (34 checks: every kind of person and both sides of each birthday), 0416 (13), 0417 (25, including a live-catalog guard: any table with an author-style column must be guarded or listed as deliberately left out; `support_messages` is listed). The guard sees author-style columns only (`author_id`, `sender_id`, `commenter_id`, `poster_id`, `writer_id`); a table that stores a child's words under another column name, such as the athlete column of a photo table, is covered by this list and by review, not by the guard.
