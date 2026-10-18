import { shownName } from "@/lib/shown-name";
import { loadNameProtectedIds, type ProtectIds } from "@/lib/minor-names";
import type { FeedPost } from "@/lib/types";

// A member who is not a confirmed adult is shown in the feed as a first name and last initial ("Sam R.") with no photo: on their posts, on their comments, and when they are @mentioned. This is the one place the rule is
// applied to a post's author on the server; the browser parts (a new post arriving, comments, the mention list) ask /api/groups/[groupId]/name-protection and use the same two functions below.
export type Author = { id: string; fullName: string; avatarUrl: string | null };

export function protectAuthor<T extends Author>(author: T, protectedIds: Set<string>): T {
  if (!author.id) return author;
  const hidden = protectedIds.has("*") || protectedIds.has(author.id);
  if (!hidden) return author;
  return { ...author, fullName: author.fullName === "Former member" ? author.fullName : shownName(author.fullName, author.id, protectedIds), avatarUrl: null };
}

export async function protectPostAuthors(posts: FeedPost[], protect: ProtectIds = loadNameProtectedIds): Promise<FeedPost[]> {
  const ids = Array.from(new Set(posts.map((p) => p.author.id).filter(Boolean)));
  if (ids.length === 0) return posts;
  const protectedIds = await protect(ids);
  return posts.map((p) => ({ ...p, author: protectAuthor(p.author, protectedIds) }));
}
