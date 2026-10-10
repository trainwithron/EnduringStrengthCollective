// A public page (booking page, website) is shown only for someone who really coaches a group. The database refuses to create or change a page for anyone else (migration 0330); this is
// the same check on the way out, so a page that somehow exists for a non-coach still answers "isn't available". `db` is the server's own database client.
export async function isRealCoach(db: any, coachId: string): Promise<boolean> {
  const { data } = await db.from("group_memberships").select("group_id").eq("profile_id", coachId).eq("role", "coach").limit(1);
  return (data ?? []).length > 0;
}
