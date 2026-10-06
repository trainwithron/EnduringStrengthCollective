# Paste files: the order

Each step has two files: `apply-stepNN-...-precheck.sql` (read-only, every row must say ok = true) and `apply-stepNN-....sql` (all or nothing). Run the precheck, then the apply file. On any error: run `rollback;` once, copy the red text, send it to Spot, do not retry.

Already applied: 0264, 0265, 0266, 0253, 0248, 0267 (the files in `supabase/`).

| Order | Step | Migrations | Notes |
|---|---|---|---|
| 1 | step05 | 0236 | needs 0248 (done) |
| 2 | step01 | 0249, 0250, 0254, 0240, 0241 | |
| 3 | step02 | 0244, 0255, 0256, 0257, 0258 | |
| 4 | step03 | 0259, 0260, 0261, 0262 | |
| 5 | step04 | 0263 | needs 0246 and 0248 |
| 6 | step06 | 0251 | kiosk PINs hashed |
| 7 | **kiosk test** | | `supabase/ron-test-kiosk-checkin.md` |
| 8 | step07 | 0252 | only after the kiosk test passed and the live site is commit 0019772 or later |
| 9 | step08 | 0237, 0242 | |
| 10 | **invite-join test** | | `supabase/ron-test-invite-join.md` |
| 11 | step09 | 0238 | LAST. Only after the invite-join test passed and the live site is commit 0019772 or later. Undo: `undo-step09-0238.sql` |

Regenerate with `node scripts/build-paste-files.mjs`; `node scripts/sql-tests/paste-files.test.mjs` applies the whole sequence on the live-equivalent schema.
