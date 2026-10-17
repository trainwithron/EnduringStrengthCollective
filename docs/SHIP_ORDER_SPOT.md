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
| L | release-leaving-coach | (see git) | Release L, step 148 (0396), apply-release-l-leaving-coach-all.sql, fp 5f22a364b148bd33 | built on R, awaiting Assistant; paste BEFORE code (adds only) |
| D-held | (data) | - | HELD: step 138, apply-release-cn-held-all.sql, fp 8f22a2d348ee90d7, read check-intake-flag-list.sql first | Ron's word only |

Fingerprint = first 16 hex of sha256 of the LF-normalized file: tr -d '\r' < supabase/apply/<file> | sha256sum | cut -c1-16.
Apply order: CL (136), CM (137), CO (139), G (141), H (142 to 144), I (145), J (146), K1 (147), L (148); then deploy the code; then CP (140) after the code is live. Held 138 only on Ron's word.
