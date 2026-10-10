// A program too long for the reader to answer in one go is read in parts. This cuts the text in two near the middle, at the start of a week if there is one near there, otherwise at a
// blank line or any line break, so no exercise line is ever cut in half. Pure; no AI.

const MIN_SPLITTABLE = 1200;

// A long program is cut up BEFORE the first read, from its size, so the parts can be read at the same time and a big program takes about as long as one part: up to about 12,000
// characters is read whole, up to about 30,000 in two parts, beyond that in four. (The reader's per-minute limit is 6, so at most four parts start together.)
export const READ_WHOLE_UP_TO = 12000;
export const READ_IN_TWO_UP_TO = 30000;

// Planning the parts cuts ONLY at the start of a week ("Week 4", "Wk 4", "W4"): a part that began in the middle of a week or a day would not know which week and day it belongs to, and
// the reader would number it from week 1 again. It picks the week starts nearest the ideal cut points (1/2, or 1/4, 1/2 and 3/4); with too few week starts it makes fewer parts, and with
// none it does not cut at all (one read; if that is cut off the caller says so plainly).
const WEEK_LINE = /^\s*(week|wk|w)\s*\d+/i;

export function planParts(text: string): string[] {
  const t = text.trim();
  if (t.length <= READ_WHOLE_UP_TO) return [t];
  const lines = t.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && WEEK_LINE.test(lines[i])) starts.push(offset);
    offset += lines[i].length + 1;
  }
  if (starts.length === 0) return [t];
  const wanted = t.length <= READ_IN_TWO_UP_TO ? 2 : 4;
  const n = Math.min(wanted, starts.length + 1);
  const cuts: number[] = [];
  for (let i = 1; i < n; i++) {
    const ideal = (t.length * i) / n;
    const free = starts.filter((s) => !cuts.includes(s));
    if (free.length === 0) break;
    cuts.push(free.reduce((best, s) => (Math.abs(s - ideal) < Math.abs(best - ideal) ? s : best)));
  }
  cuts.sort((a, b) => a - b);
  const edges = [0, ...cuts, t.length];
  const parts = edges.slice(0, -1).map((from, i) => t.slice(from, edges[i + 1]).trim()).filter(Boolean);
  return parts.length > 0 ? parts : [t];
}

export function splitProgramText(text: string): [string, string] | null {
  const t = text.trim();
  if (t.length < MIN_SPLITTABLE) return null;
  const lines = t.split("\n");
  const mid = t.length / 2;
  let offset = 0;
  const starts: { index: number; at: number; isWeek: boolean; isBlank: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) starts.push({ index: i, at: offset, isWeek: /^\s*(week|wk|w)\s*\d+/i.test(lines[i]), isBlank: lines[i - 1].trim() === "" });
    offset += lines[i].length + 1;
  }
  const near = (s: (typeof starts)[number]) => Math.abs(s.at - mid);
  const inMiddle = starts.filter((s) => s.at > t.length * 0.25 && s.at < t.length * 0.75);
  const pick = (list: typeof starts) => list.slice().sort((a, b) => near(a) - near(b))[0];
  const choice = pick(inMiddle.filter((s) => s.isWeek)) ?? pick(inMiddle.filter((s) => s.isBlank)) ?? pick(inMiddle) ?? pick(starts);
  if (!choice) {
    // One long line with no breaks: cut at the nearest space.
    const cut = t.lastIndexOf(" ", Math.floor(mid));
    return cut > 0 ? [t.slice(0, cut).trim(), t.slice(cut).trim()] : null;
  }
  const first = lines.slice(0, choice.index).join("\n").trim();
  const second = lines.slice(choice.index).join("\n").trim();
  return first && second ? [first, second] : null;
}
