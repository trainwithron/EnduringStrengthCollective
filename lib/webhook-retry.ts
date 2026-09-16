// Pure backoff math for /api/cron/webhook-retry — this app has no real
// job queue, so "basic retry/failure handling" (per this task's own
// scope) means a cron re-checking failed deliveries on a schedule
// rather than a queue with built-in redelivery. Exponential backoff in
// minutes (1, 2, 4, 8, 16 for attempts 0-4) keeps a persistently-down
// endpoint from being hammered every cron tick while still retrying
// promptly after a likely-transient failure.
export const MAX_WEBHOOK_ATTEMPTS = 5;

export function backoffMinutesForAttempt(attemptCount: number): number {
  return Math.pow(2, attemptCount);
}

export function isDeliveryDueForRetry(
  attemptCount: number,
  lastAttemptedAt: Date,
  now: Date
): boolean {
  if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) return false;
  const dueAt = lastAttemptedAt.getTime() + backoffMinutesForAttempt(attemptCount) * 60000;
  return now.getTime() >= dueAt;
}
