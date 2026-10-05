import { normalize } from "@/lib/nav-intents";

// What Ask Spot remembers about a question it could not answer: the words, with anything that identifies a person removed,
// so Ron can see which requests the help layer misses and add them. Names on the coach's roster, emails and long numbers
// become placeholders. A name that is not on the roster cannot be recognized, which is why only unanswered questions are
// kept as text; answered ones keep only the intent ids.
const MAX_LENGTH = 200;

export function normalizeForLog(message: string, roster: { fullName: string }[] = []): string {
  // Emails and numbers first, before normalizing removes the punctuation that marks them.
  let text = message
    .toLowerCase()
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, " {email} ")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, " {number} ");

  const nameTokens = new Set<string>();
  for (const c of roster) {
    for (const part of normalize(c.fullName).split(" ")) {
      if (part.length >= 2) nameTokens.add(part);
    }
  }

  text = text.replace(/['’]s(?=\s|$)/g, "");
  const words = text
    .replace(/[^a-z0-9{}\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (nameTokens.has(w) ? "{name}" : w));

  // Collapse runs of the same placeholder ("{name} {name}" for a full name).
  const out: string[] = [];
  for (const w of words) {
    if (w.startsWith("{") && out[out.length - 1] === w) continue;
    out.push(w);
  }
  return out.join(" ").slice(0, MAX_LENGTH).trim();
}
