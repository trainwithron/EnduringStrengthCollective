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
| Z1 | release-snapshot-delete | (see git) | Release Z1, step 159 (0407), apply-release-z1-client-removals-all.sql, fp 726bef10c071be7d | remove a client without destroying them + 30-day undo for a permanent delete; adds two tables and two functions, safe before the code; saves the per-client rate, cancels upcoming sessions, archives an emptied one-on-one space, refuses a live subscription |
| W2 | release-minor-names | (see git) | W2b: Release W2b, step 157 (0405), apply-release-w2b-notice-names-all.sql, fp 2dac5abb82d97a8f; REPLACES three notice functions (not additions-only) | minors' names in the feed (code, no paste needed to deploy) + the notice triggers (paste) |
| X1 | release-athlete-read | (see git) | Release X1, step 156 (0404), apply-release-x1-athlete-narrow-reads-all.sql, fp 67dbd8a2536b6c9c | athlete narrow reads (two read-only functions + athlete screens moved, with fallback); ADDITIONS ONLY |
| W3 | release-intake-paths | (see git) | Release W3, step 155 (0403), apply-release-w3-intake-every-client-all.sql, fp b7fdb5ffac587391 | every client reaches the health form; ADDITIONS ONLY (one trigger); no code change |
| U1 | release-graduation | (see git) | Release U1, step 153 (0401), apply-release-u1-graduation-all.sql, fp e1ad756a75fed295 | graduation years + emailed history PDF; ADDITIONS ONLY (column, server-only table, new function start_next_season); does not touch 0399/0400 |
| T1 | release-front-desk | (see git) | Release T1, step 152 (0400), apply-release-t1-front-desk-all.sql, fp 2af5e220cdde4567 | front desk role + organization check-in screen; adds only, safe before the code; apply after S2's 151 |
| D-held | (data) | - | HELD: step 138, apply-release-cn-held-all.sql, fp 8f22a2d348ee90d7, read check-intake-flag-list.sql first | Ron's word only |

| B1 | release-nutrition-flag | (see git) | Release B1, step 160 (0408), apply-release-b1-nutrition-flag-all.sql, fp 6c013ec4fd15e14b | no automatic nutrition suggestions for one client; adds one coach-only table, safe before the code |
Fingerprint = first 16 hex of sha256 of the LF-normalized file: tr -d '\r' < supabase/apply/<file> | sha256sum | cut -c1-16.
Apply order: CL (136), CM (137), CO (139), G (141), H (142 to 144), I (145), J (146), K1 (147), L (148); then deploy the code; then CP (140) after the code is live. Held 138 only on Ron's word.

When V1 (guardian consent) is deployed: also remove the help article parent-view-link (lib/help-articles.ts); the support-pages test fails until it is gone.
