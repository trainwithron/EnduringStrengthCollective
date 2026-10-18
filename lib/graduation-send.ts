import type { HistorySession } from "@/lib/graduation";
import type { WeightUnit } from "@/lib/units";

// The sending loop for graduating players, with everything it touches passed in so it can be tested without a database or a mail service. The order matters:
//   1. find an address that can receive mail (none: a problem, reported);
//   2. CLAIM the player (a unique row for this season and player). If the claim already exists someone else is sending or has sent, so this call skips them: two calls at once can never email a player twice;
//   3. read the history IN FULL (a history that could not be read, or is longer than the cap, is not sent and is reported with the reason);
//   4. send; then stamp the claim as sent. If the send fails, the claim is given back so the coach can try again.
export interface GraduateRef {
  id: string;
  name: string;
}

export type Claim = "claimed" | "taken" | "error";

export interface SendDeps {
  addressOf(id: string): Promise<string | null>;
  claim(id: string): Promise<Claim>;
  release(id: string): Promise<void>;
  markSent(id: string): Promise<void>;
  history(id: string): Promise<{ sessions: HistorySession[]; failed: boolean; truncated: boolean }>;
  weightUnit(id: string): Promise<WeightUnit>;
  send(to: string, athlete: GraduateRef, sessions: HistorySession[], unit: WeightUnit): Promise<boolean>;
}

export interface Problem {
  name: string;
  why: string;
}

export const WHY = {
  noAddress: "there is no email address we can be sure is theirs (they never signed in with it, so it may have been typed by their coach)",
  tooLong: "their history is longer than can be sent (over 2,000 workouts) or could not be read in full, so none of it was sent",
  sendFailed: "the email could not be sent just now; try again",
  recordFailed: "the app could not record the send, so nothing was sent; try again",
} as const;

// Works through the list until `limit` players have been emailed (players that cannot be sent to are reported and passed over, so they never stall the ones behind them), and says how many it did not reach.
export async function sendGraduationHistories(
  graduates: GraduateRef[],
  deps: SendDeps,
  opts: { limit?: number } = {}
): Promise<{ sent: number; skipped: number; problems: Problem[]; remaining: number }> {
  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  let sent = 0;
  let skipped = 0;
  const problems: Problem[] = [];
  let reached = 0;
  for (const g of graduates) {
    if (sent >= limit) break;
    reached++;
    let claimed = false;
    try {
      const to = await deps.addressOf(g.id);
      if (!to) {
        problems.push({ name: g.name, why: WHY.noAddress });
        continue;
      }
      const claim = await deps.claim(g.id);
      if (claim === "taken") {
        skipped++;
        continue;
      }
      if (claim === "error") {
        problems.push({ name: g.name, why: WHY.recordFailed });
        continue;
      }
      claimed = true;
      const history = await deps.history(g.id);
      if (history.failed || history.truncated) {
        await deps.release(g.id);
        claimed = false;
        problems.push({ name: g.name, why: WHY.tooLong });
        continue;
      }
      const ok = await deps.send(to, g, history.sessions, await deps.weightUnit(g.id));
      if (!ok) {
        await deps.release(g.id);
        claimed = false;
        problems.push({ name: g.name, why: WHY.sendFailed });
        continue;
      }
      // The email is out. Stamp it sent, and if that fails try once more and say so in the log: an unstamped claim could be taken over after ten minutes and the player emailed again.
      try {
        await deps.markSent(g.id);
      } catch {
        try {
          await deps.markSent(g.id);
        } catch {
          console.error("[graduate] the email was sent but could not be marked sent");
        }
      }
      claimed = false; // kept: it was sent
      sent++;
    } catch {
      if (claimed) await deps.release(g.id).catch(() => undefined);
      problems.push({ name: g.name, why: WHY.sendFailed });
    }
  }
  return { sent, skipped, problems, remaining: graduates.length - reached };
}
