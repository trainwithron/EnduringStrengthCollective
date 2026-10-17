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
| I | release-i-gym-owner-tools | (see git) | Release I, step 145 (0393), apply-release-i-gym-all.sql (fp in the step file) | built, awaiting Assistant; paste BEFORE code (adds only) |
| D-held | (data) | - | HELD: step 138, apply-release-cn-held-all.sql, fp 8f22a2d348ee90d7, read check-intake-flag-list.sql first | Ron's word only |

Fingerprint = first 16 hex of sha256 of the LF-normalized file: tr -d '\r' < supabase/apply/<file> | sha256sum | cut -c1-16.
Apply order: CL (136), CM (137), CO (139), G (141), H (142 to 144), I (145); then deploy the code; then CP (140) after the code is live. Held 138 only on Ron's word.
