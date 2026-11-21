// Short help lines for a coach's billing questions (Ron, Nov 20: $4, $5, $6), shown beside the tools on a client's profile and in Help > Business. Each describes only what the
// app (and Stripe) actually does today; nothing here promises a feature the app does not have.

// $4: pausing a client with today's tools. The weekly schedule's Pause (lib/series-engine.ts pauseSeries) cancels the upcoming sessions through the usual cancel (and its credit
// rules) and Resume books them again; card renewals are Stripe's, so they are paused or cancelled in the coach's own Stripe dashboard (the app reads the
// result but never stops a charge itself).
export const PAUSE_CLIENT_LINE =
  "To pause a client: on their Programs tab, tap Pause on their weekly schedule (the upcoming sessions are cancelled the usual way, and Resume books them again). If they pay each month by card, pause or cancel that subscription in your Stripe dashboard; the app doesn't stop card charges itself.";

export const PAUSE_CLIENT_HELP = [
  "There is no one Pause button for a client. To pause a client today: open their profile, go to the Programs tab, and tap Pause on their weekly schedule. The upcoming sessions in it are cancelled the usual way, and Resume books them again. A session booked by hand outside the schedule is cancelled from the calendar as usual.",
  "If they pay each month by card, the card keeps being charged until you pause or cancel that subscription in your Stripe dashboard. The app shows the subscription as Stripe reports it, but it never stops a charge itself.",
];

// $5: a failed card payment.
export const FAILED_CARD_HELP =
  "When a client's monthly card payment fails, Stripe tries the card again by itself, on the retry schedule in your Stripe account's settings, and what happens after the last try (for example cancelling the subscription) is set there too. While Stripe is trying, the client's profile shows Payment failed with the next try when Stripe gives a date, and the client sees a note on Home with an Update my card button. Nothing in the app blocks, pauses or charges them on its own.";

// $6: the evidence pack for a card dispute.
export const DISPUTE_UPLOAD_LINE =
  "To answer a dispute: in your Stripe dashboard open the payment, choose to counter the dispute, and upload the printed page (save it as a PDF) or the files from the download as your evidence. Spotlight doesn't send anything to Stripe for you.";

export const DISPUTE_HELP =
  "If a client disputes a card payment with their bank, open their profile, go to Billing & settings, and tap Evidence for a dispute beside that payment (a package or a Quick Payment). It gathers only what the app holds: the payment, the package, the signed waiver (date and version), the sessions and group classes booked, attended and missed after it, their other card payments through Quick Payment, and your messages with them. Print it and save it as a PDF, or download the files, then upload them in the dispute screen in your Stripe dashboard. Spotlight doesn't send anything to Stripe for you.";
