// A suggested name for next season's group: a name that ends in a year ("Varsity 2026", "Fall 2026") moves on a year; any other name gets next year added ("Varsity" -> "Varsity 2027"). The coach can change it.
export function suggestSeasonName(name: string, now: Date = new Date()): string {
  const trimmed = name.trim();
  const m = /^(.*?)(\d{4})$/.exec(trimmed);
  if (m && Number(m[2]) >= 1990 && Number(m[2]) <= 2100) return `${m[1]}${Number(m[2]) + 1}`;
  return `${trimmed} ${now.getFullYear() + 1}`.trim();
}
