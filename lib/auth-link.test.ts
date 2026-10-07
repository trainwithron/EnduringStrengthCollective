import { describe, it, expect } from "vitest";
import { parseAuthLink } from "./auth-link";

describe("auth email links", () => {
  it("reads a session carried in the address fragment (server-made links)", () => {
    expect(parseAuthLink({ hash: "#access_token=AAA&refresh_token=RRR&expires_in=3600&token_type=bearer&type=signup" })).toEqual({
      kind: "tokens",
      accessToken: "AAA",
      refreshToken: "RRR",
    });
  });
  it("reads a ?code= link (made by the browser library)", () => {
    expect(parseAuthLink({ search: "?code=abc123" })).toEqual({ kind: "code", code: "abc123" });
  });
  it("reads a token_hash link", () => {
    expect(parseAuthLink({ search: "?token_hash=th&type=recovery" })).toEqual({ kind: "token_hash", tokenHash: "th", type: "recovery" });
  });
  it("reads an expired or used link, from the fragment or the address", () => {
    expect(parseAuthLink({ hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired" })).toEqual({ kind: "error", reason: "expired" });
    expect(parseAuthLink({ search: "?error=server_error&error_description=Something+else+broke" })).toEqual({ kind: "error", reason: "other" });
  });
  it("an error wins over anything else in the address", () => {
    expect(parseAuthLink({ hash: "#error_code=otp_expired&access_token=A&refresh_token=R" }).kind).toBe("error");
  });
  it("a fragment with only an access token is not enough", () => {
    expect(parseAuthLink({ hash: "#access_token=AAA" })).toEqual({ kind: "none" });
  });
  it("an ordinary address carries nothing", () => {
    expect(parseAuthLink({})).toEqual({ kind: "none" });
    expect(parseAuthLink({ hash: "", search: "?tab=forms" })).toEqual({ kind: "none" });
  });
});
