# Payments design (not built)

Status: DESIGN ONLY. Nothing here is built. Ron reads it and approves before any code.

Ron's rules, as given: the platform does not decide how a business and its coaches split revenue; it only has to make any split possible. The platform charges Stripe's own fee (2.9% plus the fixed amount) and 1% on top. Paying outside the app is allowed. A split can never total more than 100% of a payment. Refunds must work correctly; whether a client is owed one is the coach's or organization's own policy, not the platform's.

## 1. How money moves today

- A client pays for a package, a subscription, a credit pack or a Quick Payment through Stripe Checkout. The money lands in the PLATFORM's Stripe account (not the coach's).
- The webhook (`app/api/stripe/webhook/route.ts`) then grants the sessions (once, safely) and, for an organization, works out the split: it takes off Stripe's real fee plus a flat 10 cents for the platform (`computePlatformDeduction`), writes a line in the platform fee ledger, and splits what is left by each member's `revenue_share_pct`, sending each coach their part as a Stripe transfer to the coach's connected account.
- A coach who has not finished Stripe onboarding is skipped silently; their share is not paid later.
- Subscriptions renew through Stripe; the app records them in `membership_subscriptions`.

Gaps found in the audit:
1. A new organization owner's share defaults to 0%, so the owner can end up with nothing until they edit it.
2. Quick Payments settle to the platform account and there is no path that pays the coach out.
3. Shares are not capped: nothing stops the total from going over 100%.
4. A refund or a dispute does not reverse the coach transfers or the platform fee, so the platform and the coach end up out of pocket.
5. An organization owner can write the Stripe connection columns on a membership row directly (the connected account id), which a signed-in owner should never be able to do.
6. A coach who has not connected simply loses the share for that payment.

## 2. The target

**Each coach, or each organization, connects its OWN Stripe account (Stripe Connect, Express accounts).** The platform does not hold anyone's money longer than Stripe's own settlement.

**The split is the organization's, not ours.** An organization owner (or a solo coach) sets any split among its coaches: a percent or a fixed amount, per coach, per client or per package, and can change it later. The platform shows what each person gets and never suggests a number. Shares for one payment can never add up to more than 100%; the database refuses it and the split screen says so in plain words ("These shares add up to more than 100%. Lower one to save.").

**The platform's price is 1% of each in-app payment** (the Stripe application fee), plus Stripe's own fee, which stays with the connected account as Stripe normally does for Connect. Assumption to confirm: Ron's "Stripe's 2.9% plus the fixed fee, then 1% on top" means the connected account pays Stripe's fee and the 1% to us. The alternative is that the platform collects and pays Stripe's fee itself, then passes it on in the 1%; the first is simpler and keeps us out of holding funds.

**Two simple shapes, chosen by the situation:**
- **One recipient** (a solo coach, or an organization that does not split): a direct charge on the connected account with a 1% application fee. The money never touches us.
- **A split between several coaches:** the charge is collected once and transferred out to each coach by Stripe transfers (as today), with the 1% kept and each transfer marked with the payment it came from. This is the one place the platform briefly sits in the middle of the money, which is why it goes to the lawyer (section 4).

**Refunds and disputes are reversed in proportion.** When a refund or a lost dispute happens, each coach transfer is reversed by the same proportion and the platform fee is refunded by the same proportion. Nobody is paid on money that was given back. The app records the reversal against the original lines. When (or whether) a client is entitled to a refund is the coach's terms, not ours; we only make a refund the coach chooses to give work correctly.

**Paying outside the app is allowed.** There is no blocking and no penalty: a coach can take cash, a card reader, Venmo or a Stripe payment link of their own. The app still lets them record a session as paid by hand. The 1% applies only to payments made through the app.

## 3. What to build, in order, and what needs a paste

1. **Cap and defaults (small).** A database rule that a payment's shares never exceed 100% (a paste), the split screen's validation message, and the owner's default share (so a new owner is not at 0%). *Needs a paste.*
2. **Close the gap on connection columns (small).** Only the server writes the Stripe account columns; the owner's own write is removed. *Needs a paste.*
3. **Connect for everyone (medium).** Coach and organization onboarding screens, an account status on the Business page, a clear message when someone has not finished (instead of silently skipping their share). No paste.
4. **Direct charge with the 1% fee for the one-recipient case (medium).** Replaces Quick Payment settling to the platform. No paste.
5. **Split transfers marked with their payment, and reversals on refund or dispute (medium).** A record of each transfer's source so reversals are exact. *Needs a paste* for the link columns.
6. **Refund button that works (small).** A coach can refund fully or partly; the app reverses transfers and the platform fee and returns any session credits the coach chooses to give back.
7. **Subscription pause that matches a freeze (small).** When an approved pause or freeze starts, the Stripe subscription is paused; it resumes by itself when the freeze ends. No paste.
8. **Program PDF on purchase (small).** When a client buys a full program (not a group), they get one transactional email with the program PDF, reusing the existing print route, sent through the same email service as receipts. No paste.
9. **No-show sessions (nothing to build).** The coach decides how they run their business: sessions are never settled automatically; the existing mark-no-show control stays as it is.

## 4. What Ron has to do in Stripe, and what needs the lawyer

**Stripe dashboard (Ron):**
- Turn on Connect, choose Express accounts, set the platform name, logo and colors, and set the platform fee to 1% (we pass it per payment).
- Add webhook events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `transfer.created`, `transfer.reversed`, `account.updated`, `payout.failed`.
- Test the whole flow in Stripe's test mode with two connected test accounts before any real coach connects.

**Lawyer:**
- The fee wording coaches and clients see (what 1% means, who pays Stripe's fee).
- Whether the split-transfer shape makes the platform a money transmitter or a marketplace operator in the places coaches work, and what that requires.
- The coach agreement: who is the merchant, who handles chargebacks, refunds and taxes.
- Refund wording: the platform does not set a refund policy; each coach or organization states its own in its terms of service.

## 5. Not part of this design

How a business and its coaches split revenue (theirs), what a refund policy should be (theirs), and automatic settling of no-shows (the coach's choice).
