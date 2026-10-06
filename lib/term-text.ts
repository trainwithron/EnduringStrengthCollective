import { resolveTerm, type TermForm, type TermKey, type TerminologyOverrides } from "./terminology";

// A swapped word reads like any other word on the page (Ron, Oct 6): plain text with no underline or hover, in proper case where it starts a label, title,
// badge or button ("Clients", "Players") and lowercase mid-sentence ("add a client"). The word is chosen once during setup and changed in Settings.

// First letter upper-case, the rest left exactly as typed ("football players" -> "Football players", "iPad users" -> "IPad users" is avoided by only touching
// the first character).
export function capFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function termText(overrides: TerminologyOverrides, key: TermKey, form: TermForm = "singular", opts: { cap?: boolean } = {}): string {
  const text = resolveTerm(overrides, key, form);
  return opts.cap ? capFirst(text) : text;
}
