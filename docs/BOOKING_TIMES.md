# Booking at any time, not only the slot grid

Ron, Oct 6: people should be able to book in about 15-minute steps or at a custom time, "we can be human with one another, we don't have to be tied to a system".

## What was true

The database never required a start time to sit on a slot grid: `book_session` checks the overlap with other sessions and the coach's buffer, and the request functions (`request_booking`, `check_booking_request_slot`) also check that the session is inside an open window and clear of time off. Only the screens limited people, by offering a fixed list of generated slots. Four things assumed every session starts exactly on a slot, and went wrong for a session at another minute:

- the client's slot list said a slot was open when a session booked at another minute overlapped it (with no buffer);
- the daily "recurring sessions no longer fit your hours" check flagged any recurring session not at an exact slot start;
- a pending request at an off-slot time never showed as requested;
- the weekly-series "outside hours" warning did the same exact-start test.

## What was built (branch care-booking-increments)

- **Slots overlap correctly.** `slotConflict` / `isSlotBufferBlocked` use plain overlap widened by the buffer, so a session at 6:20 blocks the 6:00 and 6:15 slots even with no buffer. The client pages say "Booked" for an overlapped slot and "Too close to another session" only when it is the buffer.
- **The daily conflict check** (`bookingFitsAvailability` with the session's end, used by the cron and by the series screen) now means "the whole session is inside an open window and clear of time off", so a session at any minute inside the hours is not flagged. A session that runs past the end of the hours still is.
- **Clients (request mode): "Ask for a different time".** Beside the regular slots: a start-time list in 5-minute steps for that day, only times where a session fits inside the coach's hours, clear of time off, other sessions and the buffer (and after the minimum notice). It makes an ordinary request (`request_booking`); nothing is booked until the coach confirms. Pending requests at off-slot times are listed under "Waiting for your coach".
- **Coach: "Another time"** on the day page and in the drag-a-client scheduler: any start in 5-minute steps and any length, booked through the same `book_session` call. Outside the open hours is a warning, never a block; an overlap with another session is blocked. The scheduler also marks slots overlapped by a session at another minute as booked.
- **The Confirm card** shows the requested start to end, the coach's own time zone (not the browser's), and a plain "Outside your open hours or on your time off. You can still confirm it." when it is.
- **Hours editor:** 15, 30, 45 and 60 as one-tap choices for "Slot every", with any whole number from 5 to 480 still typeable.
- **Step 32 (migration 0287):** the session length may now be longer than the step, as long as it fits inside its window, so "start every 15 minutes with a 55-minute session" works. Until Ron applies step 32 the editor says so plainly if the database refuses ("needs a database update that has not been applied yet").

## Free (self-booking) mode

Unchanged: the slot grid, where the coach chooses the step (15 or 30 now one tap). Letting a self-booking client pick "any time inside my hours" is a possible later setting.

## Server hours check (Release S, migration 0312)

`book_session` and `reschedule_booking` now refuse a client booking or moving their OWN session outside the coach's open hours or onto time off ('that time is outside your coach's hours'), using `coach_time_is_open`. A coach booking a client, a coach who is their own client, and the server's own routines are never refused. A weekly schedule a client starts books each week through `book_session`, so a week outside the hours simply does not book.
