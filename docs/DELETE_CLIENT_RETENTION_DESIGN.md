# Deleting a client: keeping the coach's business records without the person

Status: DESIGN FOR THE LAWYER. Nothing here is built or shipped. Ron shows this to the lawyer first.

## The problem in one paragraph

A coach has business records: what a client paid, how many sessions were sold and used, subscriptions, quick payments. Those are the COACH's records (taxes, disputes, refunds, their own books). When a client is deleted, the person's data must go. Today the app keeps only ONE kind of money record after a delete (credit purchases, with the person detached). Everything else about the money disappears with the person, so a coach can lose their own books by deleting a client.

## What happens today (checked against the live database)

| Record | When the person is deleted |
| --- | --- |
| Credit purchases (what was bought, amount, date) | KEPT, person detached |
| Session credit ledger (every grant, use, refund) | erased with the person |
| Session balance, expirations, subscription credit grants | erased |
| Membership subscriptions (price, status) | erased |
| Quick payments (one-off charges) | erased |
| Booked sessions (dates, attended or not) | erased |
| Recurring schedules, schedule requests | erased |
| Billing rate set for the client | erased |
| Logged workouts, coach notes | kept or erased at the coach's choice (a separate question; not business records) |
| Revenue-split transfers | not tied to the client (tied to the coach); they block deleting the COACH |

## What we propose to keep, and what to erase

KEEP (the coach's business record, with no way to tell who the person was):
- the amount, currency, date and what was sold (package name, number of sessions) for every purchase, subscription charge and quick payment;
- the credit ledger lines (date, change in sessions, reason such as "bought", "used", "refunded"), so the coach can still show how a balance came to be;
- for each booked session: its date and length, whether it was attended or settled, and what it cost in credit (no client name, no notes);
- the coach's and organization's ids, so the records stay in the right business and the right organization.

ERASE (anything that identifies the person or is about them as a person):
- name, email, phone, date of birth, photo, health and intake forms, waiver text and signature, messages, notes about the person, progress photos, weight and nutrition logs, wearable data, goals and habits, workout detail, comments, posts;
- payment-processor identifiers that point at the person (the Stripe customer id on the record) once any open dispute window has passed; the payment id itself stays (it is a transaction, not a person);
- any free text on the money records (for example a quick-payment note that contains a name).

## How it would work (schema change, not built)

1. Make the client reference optional (nullable) on the tables whose rows are kept: credit purchases already is; add coach quick payments, the session credit ledger, membership subscriptions (ended ones) and bookings (completed or settled ones). Recurring schedules, schedule requests, balances and expirations are about the future, not money already moved, so they are still erased.
2. Add one column, `former_client_ref` (a random code made at deletion time, different for every deleted person), so a coach can see "these 12 lines were one former client" without knowing who. The code cannot be traced back to the person.
3. The delete function, instead of letting the database cascade-delete these rows, first sets the client reference to empty on them, writes the same random code on all of them, and clears the free-text fields. Then the account is deleted as today.
4. A client with a LIVE subscription still cannot be deleted until it is cancelled (unchanged), so nobody is billed for an account that is gone.
5. The coach sees a plain notice before confirming: "Their name, messages, health information and photos will be erased. Payments and session counts stay in your records without their name."
6. The platform's own audit log keeps ids and field names only (unchanged).

Rollout: one migration (nullable columns, the ref column, the changed delete function), the delete page text, and a test that deletes a client with purchases, ledger lines, a subscription, a quick payment and a booking, then checks every kept row has no person and no text, and every erased item is gone.

## Questions for the lawyer

1. Is a random per-person code on kept records enough to count as anonymised, or must the rows be unlinkable from each other too?
2. How long must or may a coach keep payment records (tax and bookkeeping rules in the places coaches work), and should the app delete the kept records after that period automatically?
3. Does the person's right to erasure give way to the coach's duty to keep financial records? Which wording belongs in the privacy policy and in the coach agreement?
4. Who is responsible for the kept records, the coach, the organization, or the platform (controller or processor wording)?
5. Which identifiers from the payment processor can stay (payment id, last four digits, customer id) and which must go?
6. Do booked-session records (attendance) count as business records, or only as the person's data?
7. For a client under 18: anything different about what is kept, or for how long?

## Not decided here

The workout history and coach notes choice (keep or erase) stays as it is today.
