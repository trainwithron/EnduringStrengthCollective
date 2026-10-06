# Kiosk check-in test (run after step 06, before step 07)

Purpose: prove the new hashed PINs and the five-wrong-tries lock work on the live site before step 07 deletes the old plain-text PIN column. About 5 minutes. Use a test client, not a real one.

You need: a group where you are the coach, with at least one client in it (the Test Sandbox group is fine).

## Steps

1. Signed in as the coach, open `/groups/<groupId>/kiosk/settings`. Find a test client in the list.
   - Press **Generate** (or **Reset** if they already have a PIN). A 4-digit PIN appears **once**. Write it down.
   - Expected: the PIN shows, the client's row now says they have a PIN.
2. Open `/groups/<groupId>/kiosk` (the tablet screen). Tap that client, enter the **right** PIN.
   - Expected: a check-in confirmation. No error.
3. Back on the kiosk screen, tap the same client and enter a **wrong** PIN four times.
   - Expected: each time "Wrong PIN — try again."
4. Enter a wrong PIN a **fifth** time.
   - Expected: "Too many wrong tries. Try again later, or ask your coach."
5. Now enter the **right** PIN.
   - Expected: still "Too many wrong tries" (a locked PIN refuses even the right one).
6. Unlock it: on `/kiosk/settings` press **Reset** for that client, note the new PIN, check in once with it.
   - Expected: check-in works again.
7. Optional, a client who had a PIN before step 06: check in with their old 4-digit PIN.
   - Expected: it still works (old PINs were copied across hashed).

## Read-only check in the Supabase SQL editor (changes nothing)

```sql
-- Nobody's PIN is readable here, only whether it exists and its lock state.
select athlete_id, failed_attempts, lock_count, locked_until, set_at
from public.kiosk_pins
order by set_at desc
limit 10;
```

After step 4 the row for your test client shows `lock_count = 1` and `locked_until` about 15 minutes ahead. After step 6 it shows `lock_count = 0`, `locked_until` empty.

## Result

- Everything above as expected: tell Spot "kiosk test passed" and go on to step 07.
- Anything different (a PIN that should work is refused, the lock never happens, an error page): **do not run step 07.** Send Spot what you saw and at which step. Step 06 is safe to leave as it is; the old column still exists, so check-in keeps working.
