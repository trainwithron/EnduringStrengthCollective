import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FeedPost } from "./types";
import { protectAuthor, protectPostAuthors } from "./post-name-protection";
import { renderWithMentions } from "@/components/feed/mention-text";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const post = (authorId: string, name: string, avatar: string | null = "https://img/a.png"): FeedPost =>
  ({ id: "p" + authorId, groupId: "g", postType: "user_post", channel: "general", pinnedAt: null, eventId: null, body: "hi", mediaUrl: null, mediaType: null, createdAt: "2026-10-18T00:00:00Z", author: { id: authorId, fullName: name, avatarUrl: avatar }, workoutSummary: null, reactionCount: 0, viewerHasReacted: false, commentCount: 0 }) as FeedPost;

describe("a minor's name and photo on a post", () => {
  it("someone who is not a confirmed adult is 'First L.' with no photo; an adult is untouched", () => {
    const minors = new Set(["kid"]);
    expect(protectAuthor({ id: "kid", fullName: "Sam Rivera", avatarUrl: "https://img/a.png" }, minors)).toEqual({ id: "kid", fullName: "Sam R.", avatarUrl: null });
    expect(protectAuthor({ id: "adult", fullName: "Pat Lee", avatarUrl: "https://img/b.png" }, minors)).toEqual({ id: "adult", fullName: "Pat Lee", avatarUrl: "https://img/b.png" });
  });

  it("when the age lookup fails everyone is protected, never the other way round; a former member stays 'Former member'", () => {
    expect(protectAuthor({ id: "a", fullName: "Pat Lee", avatarUrl: "x" }, new Set(["*"]))).toEqual({ id: "a", fullName: "Pat L.", avatarUrl: null });
    expect(protectAuthor({ id: "gone", fullName: "Former member", avatarUrl: null }, new Set(["*"]))).toEqual({ id: "gone", fullName: "Former member", avatarUrl: null });
  });

  it("the feed's posts are protected in one batch using the server's lookup", async () => {
    const protect = vi.fn(async () => new Set(["kid"]));
    const out = await protectPostAuthors([post("kid", "Sam Rivera"), post("adult", "Pat Lee"), post("kid", "Sam Rivera")], protect);
    expect(protect).toHaveBeenCalledTimes(1);
    expect(protect).toHaveBeenCalledWith(["kid", "adult"]);
    expect(out.map((p) => p.author.fullName)).toEqual(["Sam R.", "Pat Lee", "Sam R."]);
    expect(out[0].author.avatarUrl).toBeNull();
    expect(out[1].author.avatarUrl).toBe("https://img/a.png");
  });

  it("an @mention of a shortened name is highlighted whole, with its full stop", () => {
    const nodes = renderWithMentions("Nice one @Sam R. and @Pat Lee!");
    const spans = nodes.filter((n) => typeof n !== "string") as { props: { children: string } }[];
    expect(spans.map((s) => s.props.children)).toEqual(["@Sam R.", "@Pat Lee"]);
  });
});

describe("where the rule is applied", () => {
  it("the feed page protects the server-rendered posts; a live post, the comments, the mention list and the notices go through the same lookup", () => {
    expect(src("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("shaped = await protectPostAuthors(shaped);");
    expect(src("components/feed/feed-list.tsx")).toContain("shaped.author = protectAuthor(shaped.author, await fetchProtectedIds(groupId, [shaped.author.id]));");
    const comments = src("components/feed/inline-comment-section.tsx");
    expect(comments).toContain("fetchProtectedIds(gid, ids)");
    expect(comments).toContain("shownName(m.fullName, m.id, protectedIds)");
    expect(comments).toContain("await nameForOthers(post.group_id, viewerId, viewerProfile.full_name)");
    expect(src("lib/use-mention-autocomplete.ts")).toContain("shownName(m.fullName, m.id, protectedIds)");
    expect(src("components/feed/new-post-composer.tsx")).toContain("await nameForOthers(groupId, posterId");
    expect(src("components/feed/desktop/post-composer-desktop.tsx")).toContain("await nameForOthers(groupId, user.id");
  });
});

// ---- the lookup route
const state = vi.hoisted(() => ({ seat: true as boolean, members: ["kid", "adult"], loadResult: new Set<string>(["kid"]), membersError: false }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.seat ? { role: "athlete" } : null, error: null }) }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ in: async (_c: string, ids: string[]) => ({ data: state.membersError ? null : state.members.filter((m) => ids.includes(m)).map((profile_id) => ({ profile_id })), error: state.membersError ? { message: "x" } : null }) }) }) }),
  }),
}));
vi.mock("@/lib/minor-names", () => ({ loadNameProtectedIds: async () => state.loadResult }));

import { POST } from "@/app/api/groups/[groupId]/name-protection/route";
const ask = (ids: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ids }) }), { params: Promise.resolve({ groupId: "g" }) }).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("the name-protection lookup", () => {
  beforeEach(() => {
    state.seat = true;
    state.membersError = false;
    state.loadResult = new Set(["kid"]);
  });

  it("answers for members, and protects anyone who is not a member of that group (so it tells nothing about people elsewhere)", async () => {
    const r = await ask(["kid", "adult", "stranger"]);
    expect(r.body.protectedIds.sort()).toEqual(["kid", "stranger"]);
  });

  it("only a member of the group can ask", async () => {
    state.seat = false;
    expect((await ask(["kid"])).status).toBe(404);
  });

  it("if the lookup fails, everyone is protected", async () => {
    state.membersError = true;
    expect((await ask(["adult"])).body.protectedIds).toEqual(["*"]);
    state.membersError = false;
    state.loadResult = new Set(["*"]);
    expect((await ask(["adult"])).body.protectedIds).toEqual(["*"]);
  });

  it("an empty or bad list answers with nobody and does no work", async () => {
    expect((await ask([])).body.protectedIds).toEqual([]);
    expect((await ask("nope")).body.protectedIds).toEqual([]);
  });
});
