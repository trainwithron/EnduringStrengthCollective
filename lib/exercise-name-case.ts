// A typed exercise name gets a capital on the first letter of every word and nothing else changed: "bech press" -> "Bech Press", "wall sit" -> "Wall Sit", while "RFESS", "DB" and "RDL" stay exactly as
// typed and "dumbbell" becomes "Dumbbell". Used when a typed name is committed (leaving the box, Enter, the quick-add line); a name picked from the library keeps the library's own casing, and
// names already saved are never rewritten.
export function capitalizeWords(text: string): string {
  return text.replace(/(^|\s)(\p{L})/gu, (_m, space: string, letter: string) => space + letter.toUpperCase());
}
