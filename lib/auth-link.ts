// What a link from one of our auth emails carries when it lands on /confirm-email or /set-password. The links come in three shapes depending on how the email was
// made: the session in the address FRAGMENT (links made by the server: signup confirmation, a coach invite, the emailed sign-in link), a ?code= (made by the browser
// library, which only works in the browser that asked), or ?token_hash=&type= (a custom email template). The browser library only understands the shape it was
// built for (ours is PKCE, so it refuses a fragment link: "Link invalid or expired"), so the landing pages read the link themselves.

export type AuthLink =
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "token_hash"; tokenHash: string; type: string }
  | { kind: "code"; code: string }
  | { kind: "error"; reason: "expired" | "other" }
  | { kind: "none" };

export function parseAuthLink(input: { hash?: string; search?: string }): AuthLink {
  const hash = new URLSearchParams((input.hash ?? "").replace(/^#/, ""));
  const query = new URLSearchParams((input.search ?? "").replace(/^\?/, ""));
  const get = (k: string) => hash.get(k) ?? query.get(k);

  if (get("error") || get("error_code") || get("error_description")) {
    const code = (get("error_code") ?? "").toLowerCase();
    const text = (get("error_description") ?? "").toLowerCase();
    return { kind: "error", reason: code === "otp_expired" || /expired|invalid|already/.test(text) ? "expired" : "other" };
  }
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "tokens", accessToken, refreshToken };
  const tokenHash = query.get("token_hash");
  const type = query.get("type");
  if (tokenHash && type) return { kind: "token_hash", tokenHash, type };
  const code = query.get("code");
  if (code) return { kind: "code", code };
  return { kind: "none" };
}
