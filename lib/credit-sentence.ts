import type { CreditPicture } from "./credit-picture";

// The click-through sentence: plain words, never an equation. Zero parts are dropped, singular and plural are right, the coach's own word for a session is used,
// and a client reads "you". The coach is told when more are booked than are left (by name, no jargon); a client never hears "owed" or "to mark".

export interface Noun {
  singular: string;
  plural: string;
}
export const SESSION_NOUN: Noun = { singular: "session", plural: "sessions" };

const count = (n: number, noun: Noun) => `${n} ${n === 1 ? noun.singular : noun.plural}`;

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const waiting = (toMark: number) => (toMark === 1 ? " 1 is waiting to be marked." : ` ${toMark} are waiting to be marked.`);

// For the coach about one client. `name` is the client's name.
export function coachCreditSentence(p: CreditPicture, name: string, noun: Noun = SESSION_NOUN): string {
  const marked = p.toMark > 0 ? waiting(p.toMark) : "";
  const over = p.booked > p.left ? p.booked - p.left : 0;
  const overClause = over > 0 ? ` ${over} more ${over === 1 ? "is" : "are"} booked than ${name} has left` : "";
  // Already owed from before (a negative balance), when it is not just the booked ones running over.
  const owesNow = Math.max(0, p.owed - over);
  const owesClause = owesNow > 0 ? ` ${name} owes ${count(owesNow, noun)}.` : "";

  if (p.bought != null && p.done != null && p.bought > 0) {
    const head = `${count(p.bought, noun)} bought`;
    if (p.done >= p.bought && p.booked === 0 && p.toBook === 0) {
      return `${head}, ${p.bought === 1 ? "and it has been completed" : `all ${p.bought} completed`}.${owesClause}${marked}`;
    }
    const parts: string[] = [];
    if (p.done > 0) parts.push(`${p.done} completed`);
    if (p.booked > 0) parts.push(`${p.booked} booked`);
    if (p.toBook > 0) parts.push(`${p.toBook} left to schedule`);
    const sentence = parts.length === 0 ? head : parts.length === 1 ? `${head}, and ${parts[0]}` : `${head}, ${joinParts(parts)}`;
    return `${sentence}${overClause ? `;${overClause}` : ""}.${owesClause}${marked}`;
  }

  // Without the history: where things stand now.
  if (p.left === 0 && p.booked === 0 && p.owed === 0) return `${name} has no ${noun.plural} left.${marked}`;
  const lead = `${name} has ${count(p.left, noun)} left`;
  if (p.booked === 0) return `${lead}.${owesClause}${marked}`;
  const tail = p.toBook > 0 ? `${p.booked} booked, and ${p.toBook} left to schedule` : `${p.booked} booked`;
  return `${lead}: ${tail}.${overClause ? `${overClause}.` : ""}${owesClause}${marked}`;
}

// For the client about themselves.
export function clientCreditSentence(p: CreditPicture, noun: Noun = SESSION_NOUN): string {
  if (p.left === 0 && p.booked === 0) return `You don't have any ${noun.plural} left right now.`;
  const lead = `You have ${count(p.left, noun)} left`;
  return p.booked > 0 ? `${lead}, and ${p.booked} ${p.booked === 1 ? "is" : "are"} on the calendar.` : `${lead}.`;
}
