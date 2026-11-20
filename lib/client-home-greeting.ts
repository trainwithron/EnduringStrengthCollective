// The top of a client's Home (Look Refresh, client step, Ron Nov 20): "Hey {first name}", with "{date} · with Coach {name}" above it. From names already on the page.

function firstWord(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** "Ron" for "Ron Arnold"; a coach who wrote "Coach Ron" as their name is still "Ron". */
export function coachFirstName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim().replace(/^coach\s+/i, "");
  return firstWord(trimmed);
}

export function clientGreeting({ clientName, coachName, now, timeZone }: { clientName: string | null | undefined; coachName: string | null | undefined; now: Date; timeZone: string }): { title: string; line: string } {
  const first = firstWord(clientName);
  const date = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);
  const coach = coachFirstName(coachName);
  return {
    title: first && first !== "Unknown" ? `Hey ${first}` : "Hey there",
    line: coach && coach !== "Unknown" ? `${date} · with Coach ${coach}` : date,
  };
}
