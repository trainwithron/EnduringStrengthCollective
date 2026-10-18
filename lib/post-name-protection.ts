import { shownName } from "@/lib/shown-name";

// A member who is not a confirmed adult is shown in the feed as a first name and last initial ("Sam R.") with no photo: on their posts, on their comments, and when they are @mentioned. A coach (or an owner/admin who is
// not also a client) is an adult in charge and is shown in full; the lookup that says who is protected (lib/post-name-protection-server.ts) leaves them out. This file has no server imports so a browser component can use it.
export type Author = { id: string; fullName: string; avatarUrl: string | null };

export function protectAuthor<T extends Author>(author: T, protectedIds: Set<string>): T {
  if (!author.id) return author;
  const hidden = protectedIds.has("*") || protectedIds.has(author.id);
  if (!hidden) return author;
  return { ...author, fullName: author.fullName === "Former member" ? author.fullName : shownName(author.fullName, author.id, protectedIds), avatarUrl: null };
}
