# Payments design

Status: built for Stripe TEST MODE (Nov 9). Nothing is live until Ron sets the Stripe switches below and applies paste step 200.

Ron's decision, final: "I would never hold any of anybody's money. It would all be through their Stripe." "I am not divvying up any money ever. Everything that gets divided is on the coach's end."

CANCELLED: the earlier design's "collected once and transferred out to each coach" shape, and the proportional reversal of coach transfers. Spotlight makes no transfers, holds no client money and does no dividing.

## How money moves

- **Every client payment** (package, subscription, Quick Payment) is a **direct charge on the organization's own connected Stripe account** (the Stripe-Account header). A solo coach's organization is theirs. There are no destination charges, no separate charges and transfers, and no client money on the platform balance.
- **One payee per organization.** A gym's owner connects the one account. Spotlight pays no coach anything. The Revenue Splits page is only a display of what each coach earned, for the owner to pay out themselves.
- **Spotlight's fee** is a Stripe application fee on each payment: **1%** for an organization on a paid plan or its free trial, **5%** on the free tier (an ended trial, a lapsed plan, a payment unpaid past its grace). It follows the real plan state at the moment of each charge (`lib/platform-fee.ts`), including each subscription renewal (`invoice.created`).
- **Stripe's own fee** stays with the connected account.
- **The only money that reaches Spotlight's own Stripe:** that application fee, and coaches paying for their plan, credit packs and AI top-ups (`app/api/stripe/coach-checkout`, on the platform account).
- **Paying outside the app is allowed.** A coach can take cash or anything else and record it by hand. The fee applies only to payments made through the app.

## How it works

- **Connecting:** the Packages page shows Not connected, Finishing setup or Ready. The organization's owner connects and manages their bank on Stripe's own hosted pages, and opens their Stripe Express dashboard from the same place to see payments and payouts.
- **Packages:** saving never touches Stripe, so a package can be saved and hand-assigned with payments off or before connecting. The Product and Price are made on the payee's account at the first checkout. Prices made on the platform before this are not reused. Buy buttons show only when the payee is ready.
- **Customers:** one per client per connected account (`stripe_connected_customers`). `stripe_customers` stays for a coach paying Spotlight, and for billing from before direct charges.
- **Webhook:** one address, two endpoints (platform and Connect), each with its own signing secret. A Connect event is read on its own account, and acts on a group only if that account is the group's payee. A coach's own plan purchase is honored only on the platform's account.
- **Refunds and disputes** happen on the coach's account, in their Stripe. The app records them and tells the coach; it changes no balance or access and moves no money. The app has no refund button.
- **History:** `revenue_split_transfers` and `platform_fee_ledger` are kept and no longer written.

## Stripe settings (test mode)

- Turn on Connect and complete the platform profile; the integration creates Standard accounts (the coach's own full Stripe account).
- Platform endpoint (events on your account) at `/api/stripe/webhook`: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Signing secret: `STRIPE_WEBHOOK_SECRET`.
- Connect endpoint (events on connected accounts) at the same address: all of the above plus `invoice.created` and `account.updated`. Signing secret: `STRIPE_CONNECT_WEBHOOK_SECRET`.

## Open questions for the lawyer

- The fee wording coaches and clients see, and the coach agreement: who is the merchant and who handles chargebacks, refunds and taxes.
- Standard accounts, by Ron's decision (Nov 9): Stripe's documentation lists the connected account as liable for fraud and disputes on direct charges (the platform on Express), and an account type can't be changed once created. Stripe labels these v1 account types legacy and steers new platforms to its newer account setup; worth revisiting before live.

## Not part of this design

How a business and its coaches split revenue (theirs), what a refund policy should be (theirs), and automatic settling of no-shows (the coach's choice).
