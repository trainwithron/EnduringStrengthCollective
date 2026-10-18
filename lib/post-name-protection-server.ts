import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadNameProtectedIds, type ProtectIds } from "@/lib/minor-names";
import { chunk } from "@/lib/chunk";
import { protectAuthor } from "@/lib/post-name-protection";
import type { FeedPost } from "@/lib/types";

// Who must be shown in the feed as a first name and last initial with no photo: the leaderboard's rule (lib/minor-names.ts: anyone without an adult date of birth on file) minus the people in charge. A coach has no date of
// birth on file (they never fill in the client form), so without this every coach's posts, comments and mentions would be shortened. Left out of the protected set: anyone who holds a coach seat anywhere, and an organization
// owner or admin who is not also a client. If the age lookup failed ("*") it stays "*": everyone shortened.
export const loadFeedProtectedIds: ProtectIds = async (profileIds) => {
  const base = await loadNameProtectedIds(profileIds);
  if (base.has("*") || base.size === 0) return base;
  const ids = [...base];
  try {
    const db = createServiceRoleClient();
    const coaches = new Set<string>();
    const athletes = new Set<string>();
    const admins = new Set<string>();
    for (const part of chunk(ids, 100)) {
      const [{ data: seats, error: seatError }, { data: orgRows, error: orgError }] = await Promise.all([
        db.from("group_memberships").select("profile_id, role").in("profile_id", part).in("role", ["coach", "athlete"]),
        db.from("organization_memberships").select("profile_id").in("profile_id", part).in("role", ["owner", "admin"]),
      ]);
      if (seatError || orgError) return new Set(["*"]);
      for (const s of (seats ?? []) as { profile_id: string; role: string }[]) (s.role === "coach" ? coaches : athletes).add(s.profile_id);
      for (const o of (orgRows ?? []) as { profile_id: string }[]) admins.add(o.profile_id);
    }
    return new Set(ids.filter((id) => !coaches.has(id) && !(admins.has(id) && !athletes.has(id))));
  } catch {
    return new Set(["*"]);
  }
};

export async function protectPostAuthors(posts: FeedPost[], protect: ProtectIds = loadFeedProtectedIds): Promise<FeedPost[]> {
  const ids = Array.from(new Set(posts.map((p) => p.author.id).filter(Boolean)));
  if (ids.length === 0) return posts;
  const protectedIds = await protect(ids);
  return posts.map((p) => ({ ...p, author: protectAuthor(p.author, protectedIds) }));
}
