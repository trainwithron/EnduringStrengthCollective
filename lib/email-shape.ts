// Whether text has the shape of an email address (something@something.xx). This only decides whether the confirm button is enabled; the server checks the address for real.
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text);
}
