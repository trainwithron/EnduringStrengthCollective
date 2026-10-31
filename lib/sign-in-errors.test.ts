import { describe, expect, it } from "vitest";
import { friendlySignInError, friendlySignUpError } from "./sign-in-errors";

describe("friendlySignInError", () => {
  it("offers a resend for an unconfirmed email", () => {
    const r = friendlySignInError("Email not confirmed");
    expect(r.canResend).toBe(true);
    expect(r.message).toMatch(/isn't confirmed/);
  });
  it("explains a wrong password without naming the service", () => {
    const r = friendlySignInError("Invalid login credentials");
    expect(r.canResend).toBe(false);
    expect(r.message).toMatch(/Forgot password/);
  });
  it("handles rate limits and unknown errors", () => {
    expect(friendlySignInError("email rate limit exceeded").message).toMatch(/Too many/);
    expect(friendlySignInError(null).message).toBe("Sign in failed. Try again.");
  });
});

describe("friendlySignUpError", () => {
  it("says a refused password is too common (the exact text the auth service sent on Oct 31)", () => {
    expect(friendlySignUpError("Password is known to be weak and easy to guess, please choose a different one.")).toBe("That password is too common and easy to guess. Pick a different one.");
    expect(friendlySignUpError("User already registered")).toContain("already has an account");
    expect(friendlySignUpError("Password should be at least 8 characters.")).toBe("Password should be at least 8 characters.");
    expect(friendlySignUpError(null)).toContain("couldn't create the account");
  });
});
