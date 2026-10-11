// How a count reads on the share card's fun line: a small count as digits ("38"), a big one rounded and in words ("about 280 thousand", "about 1.8 million"). Never "0.2" of
// anything: a count under 1.15 is "about one" (the caller only uses that for a thing close to exactly one); from 1.15 to 2 it rounds to "2".

function twoSig(n: number): number {
  const digits = Math.floor(Math.log10(n)) + 1;
  const step = Math.pow(10, Math.max(0, digits - 2));
  return Math.round(n / step) * step;
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

// The count as the text that goes in front of the unit's name.
export function countPhrase(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "about one";
  if (n < 1.15) return "about one";
  if (n < 2) return "2";
  if (n < 1000) return String(Math.round(n));
  const r = twoSig(n);
  if (r < 10_000) return `about ${r.toLocaleString("en-US")}`;
  if (r < 1_000_000) return `about ${trim(r / 1000)} thousand`;
  if (r < 1_000_000_000) return `about ${trim(r / 1_000_000)} million`;
  return `about ${trim(r / 1_000_000_000)} billion`;
}
