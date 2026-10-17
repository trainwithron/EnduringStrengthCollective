# Ship order (Spot Code Chat). Stack: each branch sits on the one above it. Master was c7302614 when this stack began.

| # | Branch | Tip | Paste | Status |
|---|--------|-----|-------|--------|
| A | release-a-pwa | 90f13a8d | none | SHIPPED (master 85a2699b) |
| B | release-b-builder | 85a2699b | none | SHIPPED (master 85a2699b) |
| C | release-c-progression | (see git) | Release CL, step 136, migration 0385, file supabase/apply/apply-release-cl-all.sql, fingerprint 4d9556da5be7240c | built, awaiting Assistant; paste BEFORE the code |

Fingerprint = first 16 hex of sha256 of the LF-normalized file: `tr -d '\r' < supabase/apply/apply-release-cl-all.sql | sha256sum | cut -c1-16`.
Release C's code reads the new set_type column defensively (the workout opens and goals still work if the column is not there yet), but the set-type toggle, warm-up exclusion and the new records only work after the paste.
