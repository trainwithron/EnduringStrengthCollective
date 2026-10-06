// "a" or "an" in front of a word, so a coach's own word for a client ("athlete", "member", "client") reads right: "Find an athlete", "Find a client".
export function withArticle(word: string): string {
  const w = word.trim();
  if (!w) return "a";
  return /^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`;
}
