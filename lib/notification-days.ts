// Groups a person's notifications under day headings ("Today", "Yesterday", "Mon, Oct 5") in their own time zone, newest first.
export interface DatedEntry {
  createdAt: string;
}

export interface DayGroup<T extends DatedEntry> {
  key: string; // YYYY-MM-DD in the viewer's zone
  label: string;
  items: T[];
}

function dayKey(d: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function groupNotificationsByDay<T extends DatedEntry>(entries: T[], timeZone: string, now: Date = new Date()): DayGroup<T>[] {
  const todayKey = dayKey(now, timeZone);
  const yesterdayKey = dayKey(new Date(now.getTime() - 24 * 3600 * 1000), timeZone);
  const sorted = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const groups: DayGroup<T>[] = [];
  for (const entry of sorted) {
    const when = new Date(entry.createdAt);
    const key = dayKey(when, timeZone);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label =
        key === todayKey
          ? "Today"
          : key === yesterdayKey
          ? "Yesterday"
          : new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(when);
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(entry);
  }
  return groups;
}

// "just now", "12m ago", "3h ago", "2d ago".
export function timeAgo(iso: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
