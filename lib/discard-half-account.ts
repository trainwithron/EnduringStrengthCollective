// A coach signup that fails PART WAY (the profile or the organization could not be made) leaves a sign-in account with nothing behind it. The person is told "try again", but the address is now taken: the retry is
// answered as if the address already had an account ("Check your email") and nothing is ever sent (Oct 19 audit: one such orphan exists in the live data). So the half-made account is removed, and the retry starts clean.
// Best effort and loud: a failure to remove it is logged with the account id, never hidden, and never turns the original failure into a different answer.
export async function discardHalfCreatedAccount(serviceRole: { auth: { admin: { deleteUser: (id: string) => Promise<{ error: { message: string } | null }> } } }, userId: string): Promise<boolean> {
  try {
    const { error } = await serviceRole.auth.admin.deleteUser(userId);
    if (error) {
      console.error(`signup: could not remove the half-created account ${userId}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`signup: removing the half-created account ${userId} threw:`, err instanceof Error ? err.message : err);
    return false;
  }
}
