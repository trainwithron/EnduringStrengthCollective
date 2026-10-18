// Every state of a client's subscription that can still bill them (the only one that cannot is 'canceled'). A paused subscription resumes billing, so it counts. The database's own guard in remove_client
// (migration 0407) uses the same rule (status <> 'canceled'); lib/client-removal.test.ts checks this list against the statuses the table allows.
export const LIVE_SUBSCRIPTION_STATUSES = ["active", "past_due", "incomplete", "paused"] as const;
