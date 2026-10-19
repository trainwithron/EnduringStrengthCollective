import { lowBalanceCrossing, tierForBalance, type LowBalanceTier } from "@/lib/reup";

// Running-low alerts go out as ONE push per person per day (Ron, Oct 19: five pushes in one minute at 5:26 AM, one per client, because he was marking sessions attended and each mark pushed at once). A daily job collects
// every client who has newly reached "1 left" or "out" and sends each recipient a single digest, in the coach's morning. A client appears once, at their lowest balance. "3 left" and "2 left" no longer push at all.
export const DIGEST_LOCAL_HOUR = 8;

export interface LowCreditRow {
  athleteId: string;
  groupId: string;
  balance: number;
  alertLevel: number | null;
  paymentHold: boolean;
}

export interface DigestInput {
  rows: LowCreditRow[];
  /** the client's name, by athlete id */
  names: ReadonlyMap<string, string>;
  /** who is told about a client's group: its coaches, plus the organization's owner(s) unless the client is private from the organization */
  recipientsByGroupAthlete: (groupId: string, athleteId: string) => string[];
  /** the hour (0-23) it is right now for the coach of that group, in the coach's own time zone */
  localHourForGroup: (groupId: string) => number;
}

export interface DigestPush {
  recipientId: string;
  title: string;
  body: string;
  url: string;
  clients: { athleteId: string; groupId: string; name: string; balance: number }[];
}

export interface DigestPlan {
  pushes: DigestPush[];
  /** the tier now alerted for a client's seat (so it never repeats until a top-up), or null to reset */
  levelUpdates: { athleteId: string; groupId: string; level: number | null }[];
  /** the individual alerts a text should still mirror (the text path is unchanged: one per client per tier) */
  alerted: { athleteId: string; groupId: string; tier: LowBalanceTier; balance: number; name: string; recipients: string[] }[];
}

/** "Oliver Bourne" -> "Oliver B."; one word stays as it is. */
export function shortClientName(full: string | null | undefined): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A client";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

const left = (balance: number): string => (balance <= 0 ? "0 left" : `${balance} left`);
const MAX_NAMED = 6;

/** One push for one recipient: "3 clients are running low", "Oliver B. 1 left, Cindie D. 1 left, Sawyer S. 0 left". */
export function digestText(clients: { athleteId: string; groupId: string; name: string; balance: number }[]): { title: string; body: string; url: string } {
  const sorted = [...clients].sort((a, b) => a.balance - b.balance || a.name.localeCompare(b.name));
  if (sorted.length === 1) {
    const c = sorted[0];
    return { title: `${c.name} is running low`, body: `${c.name} ${left(c.balance)}. A good moment to talk about renewing.`, url: `/groups/${c.groupId}/athletes/${c.athleteId}` };
  }
  const named = sorted.slice(0, MAX_NAMED).map((c) => `${c.name} ${left(c.balance)}`);
  const more = sorted.length - named.length;
  return { title: `${sorted.length} clients are running low`, body: `${named.join(", ")}${more > 0 ? `, and ${more} more` : ""}`, url: "/clients" };
}

export function planLowSessionDigests(input: DigestInput): DigestPlan {
  const levelUpdates: DigestPlan["levelUpdates"] = [];
  const alerted: DigestPlan["alerted"] = [];
  // one client, once, at their lowest balance (a client with seats in two groups is still one person)
  const lowestPerClient = new Map<string, { row: LowCreditRow; tier: LowBalanceTier }>();
  const notifyingSeats: { row: LowCreditRow; tier: LowBalanceTier }[] = [];

  for (const row of input.rows) {
    if (row.paymentHold) continue;
    const crossing = lowBalanceCrossing(row.balance, row.alertLevel);
    const stored = row.alertLevel ?? null;
    if ((crossing.notify === 1 || crossing.notify === 0) && input.localHourForGroup(row.groupId) === DIGEST_LOCAL_HOUR) {
      notifyingSeats.push({ row, tier: crossing.notify });
      const prev = lowestPerClient.get(row.athleteId);
      if (!prev || row.balance < prev.row.balance) lowestPerClient.set(row.athleteId, { row, tier: crossing.notify });
      continue;
    }
    // everything else only keeps the remembered tier right (a top-up resets it; "3 left" is remembered without a push)
    if (crossing.notify === null || crossing.notify === 3) {
      if (crossing.nextLevel !== stored) levelUpdates.push({ athleteId: row.athleteId, groupId: row.groupId, level: crossing.nextLevel });
    }
  }

  const byRecipient = new Map<string, DigestPush["clients"]>();
  for (const { row, tier } of lowestPerClient.values()) {
    const name = input.names.get(row.athleteId) ?? "A client";
    const recipients = input.recipientsByGroupAthlete(row.groupId, row.athleteId);
    alerted.push({ athleteId: row.athleteId, groupId: row.groupId, tier, balance: row.balance, name, recipients });
    for (const r of recipients) byRecipient.set(r, [...(byRecipient.get(r) ?? []), { athleteId: row.athleteId, groupId: row.groupId, name: shortClientName(name), balance: row.balance }]);
  }

  // every seat that reached the tier is remembered as alerted (a client with seats in two groups is told about once, and neither seat repeats tomorrow)
  for (const { row, tier } of notifyingSeats) levelUpdates.push({ athleteId: row.athleteId, groupId: row.groupId, level: tier });

  const pushes: DigestPush[] = [];
  for (const [recipientId, clients] of byRecipient) pushes.push({ recipientId, clients, ...digestText(clients) });
  return { pushes, levelUpdates, alerted };
}

export { tierForBalance };
