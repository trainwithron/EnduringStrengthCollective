# Ship order (Spot Code Chat). Stack: each branch sits on the one above it. Master was c7302614 when this stack began.

| # | Branch | Tip | Paste | Status |
|---|--------|-----|-------|--------|
| A | release-a-pwa | 90f13a8d | none | SHIPPED (master 85a2699b) |
| B | release-b-builder | 85a2699b | none | SHIPPED (master 85a2699b) |
| C | release-c-progression | ff415403 | Release CL, step 136, 0385, apply-release-cl-all.sql, fp eab4e0c37c77376e | Assistant-cleared; paste BEFORE code |
| D | release-d-intake | (see git) | Release CM, step 137, 0386, apply-release-cm-all.sql, fp dca3959f76fe0fe7 | built, awaiting Assistant; paste BEFORE code |
| D-held | (data) | - | HELD: step 138, apply-release-cn-held-all.sql, fp 1dd698bbed81ce1d, read check-intake-flag-list.sql first | Ron's word only |

Fingerprint = first 16 hex of sha256 of the LF-normalized file: tr -d '\r' < supabase/apply/<file> | sha256sum | cut -c1-16.
Apply order: CL (136), then CM (137). Code order: paste first, then the branch.
