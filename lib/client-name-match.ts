// Finding the coach's own client from the way a coach actually types or says a name (Ron, Oct 6: "pull up Johann's program", "Johan", a first name, a nickname, a typo).
// Pure, no AI, no database: it only ranks the roster it is given, and the caller gives it the coach's own people (never anyone else's). It never guesses silently:
// when more than one person fits, the caller shows the top few and the coach picks.

export interface NameCandidate {
  id: string;
  fullName: string;
}

export interface NameMatch<T extends NameCandidate> {
  client: T;
  score: number; // 0 to 1
}

// Words that name a place or an action, never a person; a client who happens to be called Will or Page is still found by their full name or a longer token.
const NOT_NAMES = new Set([
  "program", "programs", "calendar", "schedule", "nutrition", "macros", "meal", "messages", "message", "chat", "goal", "goals", "balance", "sessions", "session",
  "history", "logs", "log", "profile", "pull", "show", "open", "see", "look", "looks", "what", "does", "did", "say", "said", "last", "latest", "with", "from",
  "take", "bring", "let", "have", "has", "the", "and", "for", "that", "this", "their", "his", "her", "them", "about", "please", "workout", "workouts", "training",
  "plan", "client", "athlete", "player", "member", "page", "tell", "send", "text", "write", "check", "need", "want", "lets", "into", "over", "back", "how", "when",
]);

// A few nickname families, so "Mike" finds Michael and "Liz" finds Elizabeth. Every word in a family matches every other.
const NICKNAME_FAMILIES: string[][] = [
  ["john", "johnny", "jon", "jonathan", "johan", "johann"],
  ["mike", "michael", "mikey", "mick"],
  ["bob", "bobby", "rob", "robert", "robbie"],
  ["liz", "lizzy", "beth", "elizabeth", "eliza"],
  ["kate", "katie", "kathy", "katherine", "catherine", "cathy"],
  ["matt", "matthew"],
  ["chris", "christopher", "christine", "christina"],
  ["dave", "david", "davey"],
  ["steve", "steven", "stephen"],
  ["alex", "alexander", "alexandra", "alexis"],
  ["sam", "samuel", "samantha", "sammy"],
  ["dan", "danny", "daniel"],
  ["tom", "tommy", "thomas"],
  ["jim", "jimmy", "james", "jamie"],
  ["joe", "joey", "joseph"],
  ["ben", "benny", "benjamin"],
  ["nick", "nicky", "nicholas"],
  ["tony", "anthony"],
  ["will", "willy", "william", "bill", "billy"],
  ["andy", "drew", "andrew"],
  ["becky", "becca", "rebecca"],
  ["jen", "jenny", "jennifer", "jenn"],
  ["sue", "susie", "susan"],
  ["pat", "patrick", "patricia", "paddy"],
  ["ed", "eddie", "edward", "ted", "teddy"],
  ["rick", "ricky", "richard", "rich", "dick"],
  ["greg", "gregory"],
  ["jess", "jessie", "jessica"],
  ["abby", "abigail"],
  ["maddie", "madison", "maddy"],
  ["zach", "zack", "zachary", "zachariah"],
  ["ron", "ronnie", "ronald"],
  ["larry", "lawrence"],
  ["pete", "peter"],
  ["charlie", "charles", "chuck"],
  ["hank", "henry", "harry"],
  ["frank", "francis", "frankie"],
  ["fred", "frederick", "freddie"],
  ["mandy", "amanda"],
  ["vicky", "victoria", "vicki"],
  ["meg", "megan", "margaret", "maggie"],
];
const FAMILY_OF = new Map<string, number>();
NICKNAME_FAMILIES.forEach((fam, i) => fam.forEach((w) => FAMILY_OF.set(w, i)));

// Lowercase, accents folded, possessive and punctuation removed.
export function foldName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s(?=\s|$)/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-\s]+/g, " ")
    .trim();
}

// Edit distance where swapping two neighbouring letters counts as one change ("Jhon" is one change from "John").
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

// How well one typed word fits one name word: 1 exact, 0.96 a nickname, 0.93 one slip, 0.85 two slips in a long name, 0 no.
function tokenScore(typed: string, name: string): number {
  if (!typed || !name) return 0;
  if (typed === name) return 1;
  const fam = FAMILY_OF.get(typed);
  if (fam !== undefined && fam === FAMILY_OF.get(name)) return 0.96;
  if (typed.length < 4 || name.length < 4) return 0;
  const dist = editDistance(typed, name);
  const allowed = Math.max(typed.length, name.length) >= 8 ? 2 : 1;
  if (dist <= allowed) return dist === 1 ? 0.93 : 0.85;
  return 0;
}

// The words of a message that could be a person's name (everything that is not a known place or action word).
export function candidateNameTokens(message: string): string[] {
  return foldName(message)
    .split(" ")
    .filter((t) => t.length >= 3 && !NOT_NAMES.has(t));
}

// Ranks the roster for a message. A full name typed in order scores highest; a first or last name alone is a strong match; a nickname or a one-letter slip is a
// good match. People are listed best first, once each, and only above a floor so a stray word never names a client.
export function rankClientsByName<T extends NameCandidate>(message: string, roster: T[], limit = 3): NameMatch<T>[] {
  const typed = candidateNameTokens(message);
  if (typed.length === 0) return [];
  const folded = ` ${foldName(message)} `;
  const out = new Map<string, NameMatch<T>>();
  for (const c of roster) {
    const parts = foldName(c.fullName).split(" ").filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length > 1 && folded.includes(` ${parts.join(" ")} `)) {
      out.set(c.id, { client: c, score: 1 });
      continue;
    }
    let best = 0;
    for (const t of typed) {
      for (let i = 0; i < parts.length; i++) {
        const s = tokenScore(t, parts[i]);
        // A first name alone (or a one-word name) is a strong match but not as sure as the whole name; a last name alone is a little less sure than a first name.
        const weighted = s * (parts.length > 1 && i === parts.length - 1 ? 0.88 : 0.92);
        if (weighted > best) best = weighted;
      }
    }
    // First AND last name both typed (even with a slip in one) beats either alone.
    if (parts.length > 1) {
      const first = Math.max(0, ...typed.map((t) => tokenScore(t, parts[0])));
      const last = Math.max(0, ...typed.map((t) => tokenScore(t, parts[parts.length - 1])));
      if (first >= 0.75 && last >= 0.75) best = Math.max(best, 0.98 * Math.min(first, last));
    }
    if (best >= 0.75) {
      const existing = out.get(c.id);
      if (!existing || best > existing.score) out.set(c.id, { client: c, score: best });
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score || a.client.fullName.localeCompare(b.client.fullName)).slice(0, limit);
}

export interface ClientResolution<T extends NameCandidate> {
  // The best guess, only when it is clearly the one; otherwise null and the coach picks from `choices`.
  confident: T | null;
  choices: T[];
}

// One clear person, or the top few to pick from (two Johanns). Never a silent guess.
export function resolveClient<T extends NameCandidate>(message: string, roster: T[]): ClientResolution<T> {
  // A person who is in two groups is still one person.
  const seen = new Set<string>();
  const people = roster.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const ranked = rankClientsByName(message, people, 3);
  if (ranked.length === 0) return { confident: null, choices: [] };
  const [top, second] = ranked;
  const clear = top.score >= 0.8 && (!second || top.score - second.score >= 0.07);
  return { confident: clear ? top.client : null, choices: ranked.map((r) => r.client) };
}
