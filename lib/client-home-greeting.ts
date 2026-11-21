// The top of a client's Home (Look Refresh, client step, Ron Nov 20): "Hey {first name}", with "{date} · with Coach {name}" above it. From names already on the page.

import { greetingFirstName } from "@/lib/first-name";

/** "Ron" for "Ron Arnold"; a coach who wrote "Coach Ron" as their name is still "Ron" (one rule with the coach Home band: lib/first-name.ts). */
export function coachFirstName(fullName: string | null | undefined): string {
  return greetingFirstName(fullName);
}

export function clientGreeting({ clientName, coachName, now, timeZone }: { clientName: string | null | undefined; coachName: string | null | undefined; now: Date; timeZone: string }): { title: string; line: string } {
  const first = greetingFirstName(clientName);
  const date = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);
  const coach = coachFirstName(coachName);
  return {
    title: first && first !== "Unknown" ? `Hey ${first}` : "Hey there",
    line: coach && coach !== "Unknown" ? `${date} · with Coach ${coach}` : date,
  };
}

// The one row on a client's Home that opens their messages (CL11, Nov 21): "Message Ron", or "Message your coach" with no name.
export function messageCoachLabel(coachName: string | null | undefined): string {
  return coachName && coachName.trim() ? `Message ${coachFirstName(coachName)}` : "Message your coach";
}
