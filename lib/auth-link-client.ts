import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAuthLink, tokenSubject } from "@/lib/auth-link";

// Browser only. Turns the link in the address into a signed-in session, whichever shape it has (see lib/auth-link.ts), then clears it from the address so a
// reload or a copied address never carries a login. Returns "ok" when someone is signed in afterwards (including when the library already did it itself),
// "expired" for a link that is used up or old, "none" when the address carried nothing, "failed" otherwise.
// "conflict": someone else is already signed in here and the link is for a different account. Nothing is changed (and the link stays in the address) until the page
// asks the person and calls again with { replace: true }; a link must never silently swap who is signed in (it could be one an attacker mailed).
export async function establishSessionFromLink(supabase: SupabaseClient, options: { replace?: boolean } = {}): Promise<"ok" | "expired" | "none" | "failed" | "conflict"> {
  if (typeof window === "undefined") return "none";
  const link = parseAuthLink({ hash: window.location.hash, search: window.location.search });
  if (link.kind === "none") return "none";

  let failed = false;
  try {
    if (link.kind === "error") return link.reason === "expired" ? "expired" : "failed";
    if (link.kind === "tokens") {
      if (!options.replace) {
        const existing = (await supabase.auth.getUser()).data.user;
        const incoming = tokenSubject(link.accessToken);
        if (existing && incoming && existing.id !== incoming) return "conflict";
      }
      const { error } = await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
      failed = !!error;
    } else if (link.kind === "token_hash") {
      const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type as "signup" | "recovery" | "invite" | "magiclink" | "email" });
      failed = !!error;
    } else {
      const { error } = await supabase.auth.exchangeCodeForSession(link.code);
      failed = !!error;
    }
  } catch {
    failed = true;
  }

  // The library may have used the link itself a moment earlier (a ?code= can only be used once): if someone is signed in, it worked.
  const { data } = await supabase.auth.getUser();
  try {
    window.history.replaceState(null, "", window.location.pathname);
  } catch {
    // Clearing the address is cosmetic.
  }
  if (data.user) return "ok";
  return failed ? "expired" : "failed";
}
