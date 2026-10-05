// Turns the raw sign-in error from the auth service into wording a person can act on, and says whether a "Resend the
// confirmation email" button belongs next to it.
export interface FriendlySignInError {
  message: string;
  canResend: boolean;
}

export function friendlySignInError(raw: string | null | undefined): FriendlySignInError {
  const msg = (raw ?? "").toLowerCase();
  if (msg.includes("not confirmed")) {
    return {
      message: "Your email isn't confirmed yet. Check your inbox (and spam) for the confirmation link, or send it again.",
      canResend: true,
    };
  }
  if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
    return {
      message: "That email and password don't match. Check them, or use \"Forgot password?\" to reset it.",
      canResend: false,
    };
  }
  if (msg.includes("rate limit") || msg.includes("too many")) {
    return { message: "Too many attempts. Wait a few minutes and try again.", canResend: false };
  }
  return { message: raw && raw.length < 160 ? raw : "Sign in failed. Try again.", canResend: false };
}
