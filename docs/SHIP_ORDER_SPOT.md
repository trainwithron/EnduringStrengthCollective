# Ship order (Spot Code Chat). Stack: each branch sits on the one above it. Master was c7302614 when this stack began.

| # | Branch | Tip | Paste | Status |
|---|--------|-----|-------|--------|
| A | release-a-pwa | 90f13a8d | none | SHIPPED (master 85a2699b) |
| B | release-b-builder | 85a2699b | none | SHIPPED (master 85a2699b) |
| C | release-c-progression | (see git) | Release CL, step 136, 0385, apply-release-cl-all.sql, fp 5407fd8bc7156759 | Assistant-cleared (after review fixes); paste BEFORE code |
| D | release-d-intake | (see git) | Release CM, step 137, 0386, apply-release-cm-all.sql, fp f3bdd21aa30a4cf9 (adds only) | Assistant-cleared; paste BEFORE code |
| E | release-e-minors | (see git) | Release CO, step 139, 0387, apply-release-co-all.sql, fp 89dfba2466affd00 | Assistant-cleared; paste BEFORE code |
| C2 | release-c2-units | (see git) | none | Assistant-cleared |
| C3 | release-c3-guards | (see git) | none | Assistant-cleared |
| F | release-f-silent-failures | (see git) | none | Assistant-cleared |
| CP | (after the code is live) | - | Release CP, step 140, 0388, apply-release-cp-all.sql, fp e01025b329dbd888 | run AFTER the Release D code is live: switches on the guard that stops a browser finishing its own health form |
| DW | duplicate-week-no-progressions | (see git) | none | Assistant-cleared; "Copy as is" on Duplicate week |
| G | release-g-scale | cba14678 | Release G, step 141, 0389, apply-release-g-all.sql, fp b3223e923005389e | Assistant-cleared; paste BEFORE code |
| H | release-h-getting-in-and-out | 45aff8aa | Release H, steps 142 (0390), 143 (0391), 144 (0392), apply-release-h-importers-all.sql, fp 8cfe436c67fd2856 | Assistant-cleared; paste BEFORE code (adds only) |
| I | release-i-gym-owner-tools | 89840b70 | Release I, step 145 (0393), apply-release-i-gym-all.sql, fp 4566705a04ad5fde | Assistant-cleared; paste BEFORE code (adds only) |
| (shipped) | master 89840b70 | - | C through I deployed Oct 17 | LIVE (dpl_BXvQ4MQhgiFith7NQsgttZiEo48b) |
| J | release-j-home-seasons | 098e151f | Release J, step 146 (0394), apply-release-j-home-seasons-all.sql, fp 210a674a3e6bdba2 | Assistant-cleared; paste BEFORE code (adds only) |
| K2 | release-k2-mobile-fit | (see git) | none | built, awaiting Assistant |
| K1 | release-k1-notifications | e2ce546f | Release K1, step 147 (0395), apply-release-k1-notifications-all.sql (fp in the step file) | built, awaiting Assistant; paste BEFORE code (adds only) |
| R | release-integrated | 1493ad60 | none | K2 + resend + age-cap removal + Commander review fixes; awaiting Assistant clearance and Ron |
| L | release-leaving-coach | (see git) | Release L, step 148 (0396), apply-release-l-leaving-coach-all.sql, fp 86ffbb87846409c3 | built on R, awaiting Assistant; paste BEFORE code (adds only) |
| F1 | release-f1-free-tier-ai | (see git) | none | free tier AI gate behind COACH_BILLING_ENFORCED (off); built on master 1493ad60, independent of L |
| F2 | release-f2-client-cap | (see git) | Release F2, step 149 (0397), apply-release-f2-client-cap-all.sql, fp 979398d89cdde8a9 | stacked on L + F1; installed SWITCHED OFF, adds only |
| S1 | release-signin-hardening | (see git) | Release S1, step 150 (0398), apply-release-s1-signin-hardening-all.sql, fp 8628d711b21b9d5a | built on master eb5ed58d; adds only, paste BEFORE code |
| S2 | release-health-answers | (see git) | Release S2, step 151 (0399), apply-release-s2-health-answers-all.sql, fp 331e4a4fa00b98b1 | built on master 408e6919; apply and deploy together |
| S3 | release-team-coach | (see git) | none | team coach Home tiles and menus; built on master 408e6919 |
| V1 | release-guardian | (see git) | Release V1, step 154 (0402), apply-release-v1-guardian-consent-all.sql, fp 7198afb8dbd00aff | guardian consent 13 to 17 + under-13 hard block; ADDITIONS ONLY (server-only table + one function) but APPLY BEFORE DEPLOY: with the code live every 13 to 17 client is stopped until a guardian signs |
| Z1 | release-snapshot-delete | (see git) | Release Z1, step 159 (0407), apply-release-z1-client-removals-all.sql, fp 726bef10c071be7d | remove a client without destroying them + 30-day undo for a permanent delete; adds two tables and two functions, safe before the code; saves the per-client rate, cancels upcoming sessions, archives an emptied one-on-one space, refuses a live subscription |
| X2 | release-athlete-restrict | (see git) | Release X2, step 158 (0406), apply-release-x2-athlete-narrow-memberships-all.sql, fp 3613a4b7cde6ef0a; CHANGES access: apply ONLY after step 156 and the X1 code | athletes stop reading other athletes' membership rows (one restrictive read rule) |
| W2 | release-minor-names | (see git) | W2b: Release W2b, step 157 (0405), apply-release-w2b-notice-names-all.sql, fp 2dac5abb82d97a8f; REPLACES three notice functions (not additions-only) | minors' names in the feed (code, no paste needed to deploy) + the notice triggers (paste) |
| X1 | release-athlete-read | (see git) | Release X1, step 156 (0404), apply-release-x1-athlete-narrow-reads-all.sql, fp 67dbd8a2536b6c9c | athlete narrow reads (two read-only functions + athlete screens moved, with fallback); ADDITIONS ONLY |
| W3 | release-intake-paths | (see git) | Release W3, step 155 (0403), apply-release-w3-intake-every-client-all.sql, fp b7fdb5ffac587391 | every client reaches the health form; ADDITIONS ONLY (one trigger); no code change |
| U1 | release-graduation | (see git) | Release U1, step 153 (0401), apply-release-u1-graduation-all.sql, fp e1ad756a75fed295 | graduation years + emailed history PDF; ADDITIONS ONLY (column, server-only table, new function start_next_season); does not touch 0399/0400 |
| T1 | release-front-desk | (see git) | Release T1, step 152 (0400), apply-release-t1-front-desk-all.sql, fp 2af5e220cdde4567 | front desk role + organization check-in screen; adds only, safe before the code; apply after S2's 151 |
| D-held | (data) | - | HELD: step 138, apply-release-cn-held-all.sql, fp 8f22a2d348ee90d7, read check-intake-flag-list.sql first | Ron's word only |

| HP1 | release-help-pending | (see git) | none | ORDER: keep unmerged until Z1, B1, M1 and SP1 are ALL deployed; then rebase, set the four lib/changelog.ts dates (hard-coded 2026-10-18) to the deploy day, run the suite, ship. Help articles + what's new for those four; its test fails on purpose on any tree without all four features |

| T1 | release-trust | (see git) | Release T1, step 164 (0412), apply-release-t1-export-my-data-all.sql, fp in the step file | Download my data = everything (one function, two functions and a private bucket, adds only, safe before the code; the route tolerates them missing); breach runbook section; wearable-token encryption follows |

| AF3e-A | af3-database | (see git) | Release AF3e paste A, step 167 (0415), apply-release-af3e-a-minor-may-write-all.sql, fp in the step file | minor_may_write(): a read-only function; nothing uses it yet; safe any time; RON APPLIES | APPLIED Oct 18 (Ron; verified live by Commander and by me: reviewed text) |
| AF3e-B | af3-database | (see git) | Release AF3e paste B, step 168 (0416), apply-release-af3e-b-write-guard-posts-all.sql, fp in the step file | restrictive write guard on posts only; after A; RON APPLIES | APPLIED Oct 18 (Ron; verified live by Commander: restrictive insert/update guards on posts) |
| AF3e-C | af3-database | (see git) | Release AF3e paste C, step 169 (0417), apply-release-af3e-c-write-guard-rest-all.sql, fp in the step file | the guard on the 13 other tables; ONLY after B has run clean a few days (Commander says when); RON APPLIES | APPLIED Oct 18 (Ron; verified live by Commander: 14 tables guarded, 2 storage policies; released early after a simulation over all 30 athlete accounts matched the page gate) |
| AF3 | af3-database | (see git) | Release AF3, step 170 (0418), apply-release-af3-database-policies-all.sql, fp in the step file | REPLACES two posts policies, one tag policy, profile_reference_policy() and guardian_consent_state(); adds two functions and a trigger; code reads the same rules (guardian void/resend, account deletion list); paste BEFORE the code | APPLIED Oct 18 (Ron; verified live: both triggers, athlete_private_from_org, reviewed text, reference policy complete) |

| TS3 | team-sheet-3 | (see git) | Release TS3, step 171 (0419), apply-release-ts3-team-sheet-save-all.sql, fp 07c7eedf4bfeee05 | team sheet upload, review, save and undo: one table, one notice kind (rebuilds the notification type list), three functions (one private); the save is keyed on the sheet code workout ids, never scheduled_date; sent in pieces of 50 that join into one upload; paste BEFORE the code; NOT applied |
| OWN1 | release-own1 | (see git) | Release OWN1, step 172 (0420), apply-release-own1-owner-accepted-only-all.sql, fp e8b139335728714a | ownership only to someone who has signed in (a real sign-in; a confirmed link is not enough); REPLACES two functions (transfer_organization_ownership, guard_organization_columns) and adds one function and one trigger; the paste checks both live texts first; code reads the same rule; NOT applied |

| TC3A | tc3 | (see git) | Release TC3 part A, step 173 (0421), apply-release-tc3-coach-join-links-all.sql, fp a56050ec3f546a16 | one invitation link per invited person (/join-coach/<id>.<signature>, the same in the email and the copied one, used only by choosing a password on the page, 14 days, Send again extends it); ONE new table, additions only; paste BEFORE the code; the signature is made from JOIN_LINK_SECRET, else SHARE_LINK_SECRET, else the service key (nothing is stored); NOT applied |
| TC3B | tc3b-minisite | (see git) | Release TC3 part B, step 174 (0422), apply-release-tc3b-client-requests-all.sql, fp 1b08d63ca3e60a0c | Request to train with me button on the coach public page (/c/<slug>); one column (accepts_requests, on), three tables, eight functions, two notice kinds; a request grants nothing until the coach approves; paste BEFORE the code; PASTE ONLY, code not built yet, NOT applied |
| SPEEDA | mig-a | (see git) | SPEED A, step 178 (0426), apply-speed-a-org-wall-set-based-all.sql, fp 8473823878adf810 | the organization wall asks once per query, not once per row: one function (active_org_group_ids: the named org groups + only the caller own personal spaces) and the 90 org_wall_header policies rewritten in place; live proof 0 mismatches over 630 table checks / 36,372 rows; group_workout_exercises 1,363 ms -> 3.9 ms; independent of 0425; NOT applied |
| FIX4 | one-org | (see git) | FIX 4, step 177 (0425), apply-fix4-org-wall-follows-active-org-all.sql, fp 795641108970c2cb | the organization wall follows the organization the person chose (x-workspace-org, only one they belong to; else the group header as before); REPLACES one function (request_workspace_org, 0348 text checked first); safe either order; NOT applied |
| FIX2 | assign-original | (see git) | FIX 2, step 176 (0424), apply-fix2-first-assignee-gets-the-original-all.sql, fp 513e1b0db4e99dc3 | the first person a library program is assigned to gets the original, later people get a copy; REPLACES one function (assign_program_to_client, 0337 text word for word plus three conditions); the paste checks the live text first; safe either order; NOT applied |
| NS | coach-notice-switches | (see git) | Release NS, step 175 (0423), apply-release-ns-coach-notice-switches-all.sql, fp c36bf9c76061739a | a coach own on/off switch per KIND of notice (profiles.notices_off + a BEFORE INSERT trigger on notifications that drops a notice for someone who switched that kind off); additions only; paste BEFORE the code; NOT applied |
| CS1 | release-cards-switch | (see git) | Release CS1, step 166 (0414), apply-release-cs1-post-workout-cards-all.sql, fp 105a116f7d2404b2 | APPLIED Oct 18 (by Commander, column verified live); group setting Post-workout cards and PR notices; one nullable column groups.post_workout_cards, safe before the code |

| T2 | release-token-crypto | (see git) | Release T2, step 165 (0413), apply-release-t2-wearable-token-fingerprint-all.sql, fp in the step file | stacked on T1; paste BEFORE code (adds one empty column); inert until Ron sets WEARABLE_TOKEN_KEY |

| CM1 | release-moderation | (see git) | Release CM1, step 163 (0411), apply-release-cm1-report-and-block-all.sql, fp ebb062f459a6f76a | report a post or comment and block a member in the feed; adds two small tables, two functions and one notice kind, safe before the code |
| SP1 | release-support-notify | (see git) | Release SP1, step 162 (0410), apply-release-sp1-support-notices-all.sql, fp 09a62d486e02c74e | a support reply tells the other side; adds one notice kind and a trigger, safe before the code |
Fingerprint = first 16 hex of sha256 of the LF-normalized file: tr -d '\r' < supabase/apply/<file> | sha256sum | cut -c1-16.
Apply order: CL (136), CM (137), CO (139), G (141), H (142 to 144), I (145), J (146), K1 (147), L (148); then deploy the code; then CP (140) after the code is live. Held 138 only on Ron's word.

| M1 | release-money-safe | (see git) | Release M1, step 161 (0409), apply-release-m1-payment-events-all.sql, fp d291b6b927ce4ef3 | failed payments, refunds, disputes recorded + coach told + platform checks; adds one table and one notice kind, moves no money; after the code, Ron switches on 4 Stripe webhook events |
| B1 | release-nutrition-flag | (see git) | Release B1, step 160 (0408), apply-release-b1-nutrition-flag-all.sql, fp 6c013ec4fd15e14b | no automatic nutrition suggestions for one client; adds one coach-only table, safe before the code |

When V1 (guardian consent) is deployed: also remove the help article parent-view-link (lib/help-articles.ts); the support-pages test fails until it is gone.
