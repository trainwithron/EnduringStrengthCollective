// A program too long for the reader to answer in one go is read in parts. This cuts the text in two near the middle, at the start of a week if there is one near there, otherwise at a
// blank line or any line break, so no exercise line is ever cut in half. Pure; no AI.

const MIN_SPLITTABLE = 1200;

// A long program is cut up BEFORE the first read, from its size, so the parts can be read at the same time and a big program takes about as long as one part: up to about 12,000
// characters is read whole, up to about 30,000 in two parts, beyond that in four. (The reader's per-minute limit is 6, so at most four parts start together.)
export const READ_WHOLE_UP_TO = 12000;
export const READ_IN_TWO_UP_TO = 30000;

export function planParts(text: string): string[] {
  const t = text.trim();
  if (t.length <= READ_WHOLE_UP_TO) return [t];
  const halves = splitProgramText(t);
  if (!halves) return [t];
  if (t.length <= READ_IN_TWO_UP_TO) return [halves[0], halves[1]];
  const a = splitProgramText(halves[0]);
  const b = splitProgramText(halves[1]);
  return [...(a ?? [halves[0]]), ...(b ?? [halves[1]])];
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
