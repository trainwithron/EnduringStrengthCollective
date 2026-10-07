import type { CreditPicture } from "./credit-picture";

// The click-through sentence: plain words, never an equation. Zero parts are dropped, singular and plural are right, the coach's own word for a session is used,
// and a client reads "you". It always says how many are LEFT, and then, after the colon, how those split into booked and still to schedule, so the two numbers
// can never be mistaken for each other (Ron, Oct 6: "2 left" and "1 left to schedule" side by side read as a contradiction). The coach hears "owes" only for
// sessions already delivered beyond the balance; sessions booked ahead beyond what is left are neutral ("booked ahead"). A client never hears "owed" or "to mark".

export interface Noun {
  singular: string;
  plural: string;
}
export const SESSION_NOUN: Noun = { singular: "session", plural: "sessions" };

const count = (n: number, noun: Noun) => `${n} ${n === 1 ? noun.singular : noun.plural}`;

const waiting = (toMark: number) => (toMark === 1 ? " 1 is waiting to be marked." : ` ${toMark} are waiting to be marked.`);

// For the coach about one client. `name` is the client's name.
export function coachCreditSentence(p: CreditPicture, name: string, noun: Noun = SESSION_NOUN): string {
  const marked = p.toMark > 0 ? waiting(p.toMark) : "";
  const owesClause = p.owed > 0 ? ` ${name} owes ${count(p.owed, noun)}.` : "";
  const bookedWord = p.bookedAhead > 0 ? "booked ahead" : "booked";
  // After the colon: how the ones that are left split up.
  const split = p.booked > 0 ? `: ${p.booked} ${bookedWord}${p.toBook > 0 ? ` and ${p.toBook} still to schedule` : ""}` : "";

  if (p.bought != null && p.done != null && p.bought > 0) {
    const head = `${count(p.bought, noun)} bought`;
    if (p.done >= p.bought && p.booked === 0 && p.left === 0) {
      return `${head}, ${p.bought === 1 ? "and it has been completed" : `all ${p.bought} completed`}.${owesClause}${marked}`;
    }
    const parts: string[] = [];
    if (p.done > 0) parts.push(`${p.done} completed`);
    if (p.left > 0 || p.booked > 0) parts.push(`${p.left} left`);
    const text = parts.length === 0 ? head : parts.length === 1 ? `${head}, and ${parts[0]}` : `${head}, ${parts[0]}, and ${parts[1]}`;
    const none = p.booked === 0 && p.left > 0 ? ": none booked yet" : "";
    return `${text}${split || none}.${owesClause}${marked}`;
  }

  // Without the history: where things stand now.
  if (p.left === 0 && p.booked === 0 && p.owed === 0) return `${name} has no ${noun.plural} left.${marked}`;
  return `${name} has ${count(p.left, noun)} left${split}.${owesClause}${marked}`;
}

// For the client about themselves.
export function clientCreditSentence(p: CreditPicture, noun: Noun = SESSION_NOUN): string {
  if (p.left === 0 && p.booked === 0) return `You don't have any ${noun.plural} left right now.`;
  const lead = `You have ${count(p.left, noun)} left`;
  return p.booked > 0 ? `${lead}, and ${p.booked} ${p.booked === 1 ? "is" : "are"} on the calendar.` : `${lead}.`;
}
