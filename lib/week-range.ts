// Sunday-through-Saturday calendar week containing a given date — pure,
// no timezone/DB concerns, so it's directly testable apart from the
// async data-fetching that uses it (see app/groups/[groupId]/page.tsx's
// "This Week" widget).
export function getWeekRange(reference: Date): { start: Date; end: Date } {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

export function isWithinRange(date: Date, start: Date, end: Date): boolean {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}
