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

// The same for making an account: says WHY it was refused. A password on the leaked-password list was answered with a vague "check your email and password"
// (Ron, Oct 31: a new client at the gym got that and gave up on the first try).
export function friendlySignUpError(raw: string | null | undefined): string {
  const msg = (raw ?? "").toLowerCase();
  if (msg.includes("already registered") || msg.includes("already exists")) return "That email already has an account. Tap 'I have an account' to sign in.";
  if (msg.includes("rate limit") || msg.includes("too many")) return "Too many tries. Wait a few minutes and try again.";
  if (msg.includes("weak") || msg.includes("easy to guess")) return "That password is too common and easy to guess. Pick a different one.";
  if (msg.includes("password should") || msg.includes("password must")) return raw as string;
  if (msg.includes("email") && msg.includes("invalid")) return "That email address doesn't look right. Check it and try again.";
  return "We couldn't create the account. Check your email and password and try again.";
}
