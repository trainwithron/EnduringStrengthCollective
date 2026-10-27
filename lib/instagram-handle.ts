// A coach's Instagram handle, as it goes on their clients' share pictures (lib/share-image.ts). Stored without the "@": 1 to 30 letters, digits, "." and "_" (Instagram's own rule; the
// database checks the same, migration 0437). A pasted "@name" or an instagram.com/name address is cleaned to the handle.
export const INSTAGRAM_HANDLE_RULE = "Use 1 to 30 letters, numbers, periods or underscores.";
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export function cleanInstagramHandle(raw: string | null | undefined): { handle: string | null } | { error: string } {
  let v = (raw ?? "").trim();
  if (!v) return { handle: null };
  // An address: instagram.com/name, with or without https:// and www., and anything after the name.
  const url = v.match(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/+([^/?#\s]+)/i);
  if (url) v = url[1];
  v = v.replace(/^@+/, "").replace(/\/+$/, "");
  return HANDLE.test(v) ? { handle: v } : { error: INSTAGRAM_HANDLE_RULE };
}
