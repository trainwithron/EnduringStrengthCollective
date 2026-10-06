# Overnight, Oct 5 to 6: what was fixed, and what needs Ron

Nothing here is pushed or deployed (the Oct 5 evening deploy was head 981ee51 on master). No migrations were applied. Each branch stays green (tsc, tests, build).

## How the work is split so it can ship in two batches

- **`overnight-safe`**: only SAFE fixes (copy, labels, missing exits, spacing, accessibility, tests and docs, an isolated bug with a test). It starts from master plus this file, so it can be merged and deployed alone.
- **`overnight-care`**: starts from `overnight-safe` and adds the CARE fixes (anything touching credits or money, sign-in or row security, scheduling logic, data deletion, a migration, or a shared component used app-wide). Merge it only after the safe batch, and only on Ron's word.
- Each line below says SAFE or CARE and the commit.

## Batch 1 (SAFE) fixed

(Filled in as the work lands.)

**What Ron should try after batch 1:** (filled in when the batch is final.)

## Batch 2 (CARE) fixed

(Filled in as the work lands.)

**What Ron should try after batch 2:** (filled in when the batch is final.)

## Needs Ron's decision (one line each, with my recommendation)

(Filled in as findings arrive.)

## Notes

- Calendar walk-through note for Ron: `docs/HOW_TO_PUT_A_CLIENT_ON_THE_CALENDAR.md` (written once the walk-through is done).
