import type { LowBalanceTier } from "@/lib/reup";

// The words for the three low-balance alerts a coach (and the organization's owner) gets: 3 left, 1 left, none left. Shared by
// the push and the SMS so they never drift apart. A negative balance means sessions were delivered that are not paid for yet.
export function lowBalanceMessage(tier: LowBalanceTier, name: string, balance: number): { title: string; body: string } {
  if (tier === 3) {
    return {
      title: "Session package running low",
      body: `${name} has ${balance} sessions left. Worth keeping an eye on for their next renewal.`,
    };
  }
  if (tier === 1) {
    return {
      title: "One session left: renewal window",
      body: `${name} is down to their last session. This is the moment to start the renewal conversation.`,
    };
  }
  if (balance < 0) {
    return {
      title: "Out of sessions: payment due",
      body: `${name} is out of sessions and owes ${Math.abs(balance)}. Start the renewal conversation now.`,
    };
  }
  return {
    title: "Last session used: resign now",
    body: `${name} just used their final session. Start the renewal conversation now before they go quiet.`,
  };
}
