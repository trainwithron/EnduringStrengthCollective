import { describe, expect, it } from "vitest";
import { friendlySignInError } from "./sign-in-errors";

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
