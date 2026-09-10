// Rewrites Supabase Auth's raw error strings from a signup/invite email
// send into copy a coach can actually act on — used by every route that
// calls supabase.auth.signUp / auth.admin.inviteUserByEmail (coach
// signup, coach invite, client invite), since all three can hit the same
// project-wide email send failures.
export function toFriendlyAuthEmailError(message: string): { error: string; status: number } {
  if (/already registered|already exists|already been registered/i.test(message)) {
    return { error: "That email is already registered to an account.", status: 409 };
  }
  if (/rate limit/i.test(message)) {
    return {
      error: "Too many invite/signup emails sent recently — wait a few minutes and try again.",
      status: 429,
    };
  }
  return { error: message, status: 502 };
}
