# Release B: booking rules, step by step

What this changes (plain): a client who cancels or moves a session inside your cancellation window is flagged to you instead of losing a session by themselves; you choose how clients book (on their own, request and you confirm, or you schedule everyone); in request mode a client asks for a time or a move and you tap Confirm or Decline. Nothing is taken or booked behind your back.

Do these in order. Each step has a precheck (every row must say ok = true) and an apply file. If anything errors, run `rollback;` once, copy the red text, and stop.

1. **Step 19** (late change flagged for you): paste `supabase\apply\apply-step19-0277-precheck.sql`, then `apply-step19-0277.sql`.
2. **Step 20** (booking mode): paste `apply-step20-0278-precheck.sql`, then `apply-step20-0278.sql`. From this moment every coach is on "I schedule everyone", so clients cannot book themselves until you pick a mode (step 5 below).
3. **Step 21** (booking requests): paste `apply-step21-0279-precheck.sql`, then `apply-step21-0279.sql`.
4. **Optional:** paste `optional-ron-booking-mode-request.sql` to set your own coach account to "Clients request, I confirm" in one go (check the email in it is the one you sign in to coaching with). Or skip it and do step 6.
5. **Deploy the code:** type "push and deploy release B" in the Claude window.
6. **On the live site**, open Availability. If it asks for your time zone, set it. Then choose "Clients request, I confirm" (skip if you did step 4).
7. **Try it with a throwaway client:**
   - As the client, open the calendar, pick a day, and tap "Request this time". It should say Requested.
   - As you, open Home: under Needs your decision there is a Confirm and Decline row. Tap Confirm: the session is booked and the client gets a notice.
   - As the client, ask to move that session. The session stays where it is until you confirm.
   - Schedule a session a few hours from now for the client, cancel it as the client, and check the balance did not change and a Charge / Waive row appears for you.
8. If anything breaks: tell Spot, and the undo files (`undo-step21`, `undo-step20`, `undo-step19`, in that order) put it all back.
