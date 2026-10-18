import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FeedPost } from "./types";
import { protectAuthor } from "./post-name-protection";
import { protectPostAuthors, loadFeedProtectedIds } from "./post-name-protection-server";
import { fetchProtectedIds, BATCH } from "./name-protection-client";
import { renderWithMentions } from "@/components/feed/mention-text";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const post = (authorId: string, name: string, avatar: string | null = "https://img/a.png"): FeedPost =>
  ({ id: "p" + authorId, groupId: "g", postType: "user_post", channel: "general", pinnedAt: null, eventId: null, body: "hi", mediaUrl: null, mediaType: null, createdAt: "2026-10-18T00:00:00Z", author: { id: authorId, fullName: name, avatarUrl: avatar }, workoutSummary: null, reactionCount: 0, viewerHasReacted: false, commentCount: 0 }) as FeedPost;

// ---- a stand-in database for the server parts
const state = vi.hoisted(() => ({
  seat: true as boolean,
  members: ["kid", "adult", "coach"] as string[],
  loadResult: new Set<string>(["kid"]),
  baseProtected: new Set<string>(),
  membersError: false,
  seatRows: [] as { profile_id: string; role: string }[],
  adminRows: [] as string[],
  seatQueryError: false,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.seat ? { role: "athlete" } : null, error: null }) }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const f: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        in: (c: string, v: unknown) => ((f[c] = v), q),
        then(resolve: (v: unknown) => void) {
          if (table === "group_memberships" && Array.isArray(f.role)) {
            const ids = f.profile_id as string[];
            return resolve({ data: state.seatQueryError ? null : state.seatRows.filter((s) => ids.includes(s.profile_id) && (f.role as string[]).includes(s.role)), error: state.seatQueryError ? { message: "x" } : null });
          }
          if (table === "group_memberships") {
            const ids = f.profile_id as string[];
            return resolve({ data: state.membersError ? null : state.members.filter((m) => ids.includes(m)).map((profile_id) => ({ profile_id })), error: state.membersError ? { message: "x" } : null });
          }
          if (table === "organization_memberships") {
            const ids = f.profile_id as string[];
            return resolve({ data: state.adminRows.filter((a) => ids.includes(a)).map((profile_id) => ({ profile_id })), error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/minor-names", () => ({ loadNameProtectedIds: async (ids: string[]) => (state.baseProtected.has("*") ? new Set(["*"]) : new Set(ids.filter((i) => state.baseProtected.has(i)))) }));

beforeEach(() => {
  state.seat = true;
  state.membersError = false;
  state.seatQueryError = false;
  state.members = ["kid", "adult", "coach"];
  state.baseProtected = new Set(["kid", "coach", "adult"]); // as the leaderboard rule sees it: nobody here has a date of birth on file except... nobody
  state.seatRows = [];
  state.adminRows = [];
});

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

describe("the people in charge are named in full", () => {
  it("a coach has no date of birth on file, yet is NOT shortened: the feed's protected set leaves out anyone holding a coach seat", async () => {
    state.seatRows = [{ profile_id: "coach", role: "coach" }];
    const set = await loadFeedProtectedIds(["kid", "coach"]);
    expect([...set].sort()).toEqual(["kid"]);
    const out = await protectPostAuthors([post("coach", "Dana Coach"), post("kid", "Sam Rivera")]);
    expect(out[0].author).toMatchObject({ fullName: "Dana Coach", avatarUrl: "https://img/a.png" });
    expect(out[1].author).toMatchObject({ fullName: "Sam R.", avatarUrl: null });
  });

  it("an owner or admin who is not also a client is named in full; one who is also a client is treated as a client", async () => {
    state.adminRows = ["owner", "adminClient"];
    state.seatRows = [{ profile_id: "adminClient", role: "athlete" }];
    state.baseProtected = new Set(["owner", "adminClient", "kid"]);
    const set = await loadFeedProtectedIds(["owner", "adminClient", "kid"]);
    expect([...set].sort()).toEqual(["adminClient", "kid"]);
  });

  it("if the check of who is in charge fails, everyone is protected", async () => {
    state.seatQueryError = true;
    expect([...(await loadFeedProtectedIds(["kid", "coach"]))]).toEqual(["*"]);
    state.baseProtected = new Set(["*"]);
    state.seatQueryError = false;
    expect([...(await loadFeedProtectedIds(["kid"]))]).toEqual(["*"]);
  });
});

describe("a long roster", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("is asked in batches of at most 300 and the answers are joined, so a minor at position 400 is still protected", async () => {
    const ids = Array.from({ length: 520 }, (_, i) => `m${i}`);
    const seen: number[] = [];
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const asked = JSON.parse(init.body).ids as string[];
      seen.push(asked.length);
      return { ok: true, json: async () => ({ protectedIds: asked.filter((i) => i === "m400" || i === "m10") }) };
    }) as never;
    const set = await fetchProtectedIds("g", ids);
    expect(seen).toEqual([300, 220]);
    expect(Math.max(...seen)).toBeLessThanOrEqual(BATCH);
    expect([...set].sort()).toEqual(["m10", "m400"]);
  });

  it("any batch that fails protects everyone", async () => {
    let calls = 0;
    globalThis.fetch = (async () => (++calls === 2 ? { ok: false } : { ok: true, json: async () => ({ protectedIds: [] }) })) as never;
    const set = await fetchProtectedIds("g", Array.from({ length: 400 }, (_, i) => `m${i}`));
    expect(set.has("*")).toBe(true);
  });
});

describe("where the rule is applied", () => {
  it("the feed page protects the server-rendered posts; a live post, the comments, the mention list and the notices go through the same lookup", () => {
    expect(src("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("shaped = await protectPostAuthors(shaped);");
    expect(src("components/feed/feed-list.tsx")).toContain("shaped.author = protectAuthor(shaped.author, await fetchProtectedIds(groupId, [shaped.author.id]));");
    const comments = src("components/feed/inline-comment-section.tsx");
    expect(comments).toContain("fetchProtectedIds(gid, ids)");
    expect(comments).toContain('const protectedIds = gid ? await fetchProtectedIds(gid, ids) : new Set(["*"]);');
    expect(comments.match(/select\("group_id"\)/g)!.length).toBe(1); // the post's group is looked up once for the thread (the push at send time reads the author too)
    expect(comments).toContain("shownName(m.fullName, m.id, protectedIds)");
    expect(comments).toContain("await nameForOthers(post.group_id, viewerId, viewerProfile.full_name)");
    expect(src("lib/use-mention-autocomplete.ts")).toContain("shownName(m.fullName, m.id, protectedIds)");
    expect(src("components/feed/new-post-composer.tsx")).toContain("await nameForOthers(groupId, posterId");
    expect(src("components/feed/desktop/post-composer-desktop.tsx")).toContain("await nameForOthers(groupId, user.id");
  });

  it("the browser-side file has no server imports", () => {
    expect(src("lib/post-name-protection.ts")).not.toMatch(/service-role|minor-names|supabase/);
    expect(src("components/feed/feed-list.tsx")).not.toContain("post-name-protection-server");
  });

  it("the bell notices are written with the same rule by the database", () => {
    const sql = src("supabase/migrations/0405_notice_names.sql");
    expect(sql).toContain("v_commenter_name := public.notice_display_name(new.author_id);");
    expect(sql).toContain("v_author_name := public.notice_display_name(new.author_id);");
    expect(sql).toContain("c.role = 'coach'");
  });
});

// ---- the lookup route
import { POST } from "@/app/api/groups/[groupId]/name-protection/route";
const ask = (ids: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ids }) }), { params: Promise.resolve({ groupId: "g" }) }).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("the name-protection lookup", () => {
  it("answers for members, and protects anyone who is not a member of that group (so it tells nothing about people elsewhere)", async () => {
    state.baseProtected = new Set(["kid"]);
    const r = await ask(["kid", "adult", "stranger"]);
    expect(r.body.protectedIds.sort()).toEqual(["kid", "stranger"]);
  });

  it("a coach in the list is not protected", async () => {
    state.seatRows = [{ profile_id: "coach", role: "coach" }];
    const r = await ask(["kid", "coach"]);
    expect(r.body.protectedIds).toEqual(["kid"]);
  });

  it("only a member of the group can ask", async () => {
    state.seat = false;
    expect((await ask(["kid"])).status).toBe(404);
  });

  it("if the lookup fails, everyone is protected", async () => {
    state.membersError = true;
    expect((await ask(["adult"])).body.protectedIds).toEqual(["*"]);
    state.membersError = false;
    state.baseProtected = new Set(["*"]);
    expect((await ask(["adult"])).body.protectedIds).toEqual(["*"]);
  });

  it("a request for more people than one batch is never cut short: everyone is protected", async () => {
    const many = Array.from({ length: 301 }, (_, i) => `m${i}`);
    expect((await ask(many)).body.protectedIds).toEqual(["*"]);
  });

  it("an empty or bad list answers with nobody and does no work", async () => {
    expect((await ask([])).body.protectedIds).toEqual([]);
    expect((await ask("nope")).body.protectedIds).toEqual([]);
  });
});
