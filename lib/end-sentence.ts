// A sentence that ends with a name ("Programs of Enduring Strength Co.") takes its period from the name when the name already ends with one; otherwise "Co.." showed (Oct 27).
export function periodAfter(name: string | null | undefined): string {
  return /[.!?]\s*$/.test(name ?? "") ? "" : ".";
}

export function endSentence(text: string): string {
  return `${text}${periodAfter(text)}`;
}
