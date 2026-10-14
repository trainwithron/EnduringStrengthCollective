// When a coach types a request in the AI box ("build the 30-year-old mom of two template for Sam"), and they have a template that request clearly names, offer that template instead of writing a new
// program. A template matches when EVERY meaningful word of its name is in the request, so "Mom of two" matches "the mom of two template" and not "Mom of three". Pure, so it is tested.

export interface TemplateRef {
  id: string;
  name: string;
  groupId: string;
}

const FILLER = new Set(["template", "templates", "program", "programs", "the", "a", "an", "of", "for", "my", "and", "to", "plan"]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

// The templates whose name this request clearly uses, most specific (most words) first. A name with no meaningful word never matches.
export function matchTemplates(text: string, templates: TemplateRef[]): TemplateRef[] {
  const typed = new Set(words(text).map(singular));
  const scored: { t: TemplateRef; n: number }[] = [];
  for (const t of templates) {
    const key = words(t.name).filter((w) => !FILLER.has(w));
    if (key.length === 0) continue;
    if (key.every((w) => typed.has(singular(w)))) scored.push({ t, n: key.length });
  }
  scored.sort((a, b) => b.n - a.n || a.t.name.localeCompare(b.t.name));
  // When one match is clearly the most specific (it has more words than any other), it alone is offered; equal ones are all offered so the coach picks.
  if (scored.length === 0) return [];
  const best = scored[0].n;
  return scored.filter((s) => s.n === best).map((s) => s.t);
}

// The one client whose first name is in the request, if exactly one is; otherwise none (never guess between two).
export function clientNamedIn<T extends { id: string; fullName: string }>(text: string, clients: T[]): T | null {
  const typed = new Set(words(text));
  const hits = clients.filter((c) => {
    const first = words(c.fullName)[0];
    return !!first && first.length >= 3 && typed.has(first);
  });
  return hits.length === 1 ? hits[0] : null;
}
