import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BLOCK_CONFIRM, REPORTED_THANKS, REPORT_REASON_MAX, firstNameOf, withoutBlocked } from "./content-moderation";
import { loadBlockedIds } from "./blocked-members";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("blocking hides a member's posts and comments", () => {
  const posts = [
    { id: "1", author: { id: "ann" } },
    { id: "2", author: { id: "bo" } },
    { id: "3", author: { id: "" } },
    { id: "4", author: { id: "bo" } },
  ];

  it("leaves out what a blocked member wrote and nothing else", () => {
    expect(withoutBlocked(posts, new Set(["bo"]), (p) => p.author.id).map((p) => p.id)).toEqual(["1", "3"]);
  });

  it("with nobody blocked returns the list as it was", () => {
    expect(withoutBlocked(posts, new Set(), (p) => p.author.id)).toBe(posts);
  });

  it("a comment from a former member (no author) is never hidden by a block", () => {
    const comments = [{ author_id: null }, { author_id: "bo" }];
    expect(withoutBlocked(comments, new Set(["bo"]), (c) => c.author_id)).toEqual([{ author_id: null }]);
  });

  it("names the button with a first name, or a plain fallback", () => {
    expect(firstNameOf("Sam Rivera")).toBe("Sam");
    expect(firstNameOf("")).toBe("this member");
    expect(firstNameOf(null)).toBe("this member");
  });

  it("the words say nobody is told and how to undo it", () => {
    expect(BLOCK_CONFIRM("Sam")).toContain("They are not told");
    expect(BLOCK_CONFIRM("Sam")).toContain("undo this any time in Settings");
    // and says plainly what a block covers and what it does not
    expect(BLOCK_CONFIRM("Sam")).toContain("hides their posts and comments from you");
    expect(BLOCK_CONFIRM("Sam")).toContain("leaderboard and your notices");
    expect(REPORT_REASON_MAX).toBe(500);
    expect(REPORTED_THANKS).toContain("A coach will take a look");
  });
});

describe("reading the blocked list", () => {
  const db = (result: { data: unknown; error: unknown }) => ({ from: () => ({ select: async () => result }) }) as any;

  it("returns the blocked ids", async () => {
    expect(await loadBlockedIds(db({ data: [{ blocked_id: "a" }, { blocked_id: "b" }], error: null }))).toEqual(["a", "b"]);
  });

  it("reads as nobody blocked when the table is not there yet, quietly", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loadBlockedIds(db({ data: null, error: { code: "42P01", message: "x" } }))).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("any other failure also shows the feed (a block is a comfort, not a wall), and is logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loadBlockedIds(db({ data: null, error: { code: "XX000", message: "down" } }))).toEqual([]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("how it is wired", () => {
  it("the feed list, the comments and Settings use it, and a block takes effect at once", () => {
    const list = src("components/feed/feed-list.tsx");
    expect(list).toContain("withoutBlocked(posts, blocked, (p) => p.author.id)");
    expect(list).toContain("onBlocked={onBlocked}");
    const comments = src("components/feed/inline-comment-section.tsx");
    expect(comments).toContain("withoutBlocked(comments, blocked, (c) => c.author_id)");
    expect(comments).toContain("<ReportAndBlockMenu commentId={comment.id}");
    expect(src("components/feed/user-post-card.tsx")).toContain("<ReportAndBlockMenu postId={post.id}");
    // a block made on a comment also takes the member's posts out of the feed, and a blocked member is not offered when typing @
    expect(src("components/feed/report-and-block-menu.tsx")).toContain("window.dispatchEvent(new CustomEvent(BLOCKED_EVENT");
    expect(list).toContain("window.addEventListener(BLOCKED_EVENT");
    expect(comments).toContain("window.addEventListener(BLOCKED_EVENT");
    expect(src("lib/use-mention-autocomplete.ts")).toContain("!blocked.has(m.id)");
    expect(src("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("<BlockedMembersList initial={blockedMembers} />");
    const page = src("app/(coach)/groups/[groupId]/feed/page.tsx");
    expect(page).toContain("loadBlockedIds(supabase)");
    expect((page.match(/blockedIds=\{blockedIds\}/g) ?? []).length).toBe(2);
  });

  it("you cannot report or block yourself: the menu is only on other people's posts and comments", () => {
    expect(src("components/feed/user-post-card.tsx")).toContain("post.author.id !== viewerId");
    expect(src("components/feed/inline-comment-section.tsx")).toContain("comment.author_id !== viewerId");
  });

  it("a report goes through the database function, a block through the person's own rows, and a coach sees the open reports", () => {
    const menu = src("components/feed/report-and-block-menu.tsx");
    expect(menu).toContain('.rpc("report_content"');
    expect(menu).toContain('.from("user_blocks").upsert');
    expect(menu).toContain("confirmDialog");
    const panel = src("components/feed/reported-content-panel.tsx");
    expect(panel).toContain('.eq("status", "open")');
    expect(panel).not.toContain("reporter_id");
    expect(panel).toContain("Showing the newest {rows.length} of {total}.");
    expect(src("components/feed/reported-item-actions.tsx")).toContain('rpc("handle_content_report"');
    expect(src("components/feed/reported-item-actions.tsx")).toContain('rpc("remove_reported_content"');
    expect(src("components/feed/reported-item-actions.tsx")).toContain("This also removes");
    expect(src("app/reports/page.tsx")).toContain("<ReportedContentPanel");
    expect(src("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("<ReportedContentPanel");
  });

  it("the migration is the member's own for blocks and the coaches' for reports, with nothing written from a browser", () => {
    const sql = src("supabase/migrations/0411_report_and_block.sql");
    // nobody can select who reported: reporter_id is left out of the granted columns, and nothing selects it
    const grant = /grant select \(([^)]*)\) on public\.content_reports to authenticated;/.exec(sql)?.[1] ?? "";
    expect(grant).toContain("content_excerpt");
    expect(grant).not.toContain("reporter_id");
    expect(sql).toContain("revoke all on public.content_reports from anon, authenticated;");
    // who handles a report: the group's coaches except the person reported, else the organization's owner/admins, else the platform administrators
    expect(sql).toContain("gm.profile_id is distinct from p_author");
    expect(sql).toContain("om.profile_id is distinct from p_author");
    expect(sql).toContain("union all select id from org_admins where not exists (select 1 from coaches)");
    expect(sql).toContain("where not exists (select 1 from coaches) and not exists (select 1 from org_admins)");
    expect(sql).toContain("using (public.can_handle_content_report(group_id, reported_author_id))");
    // the cap, the double tap, and the kept copy
    expect(sql).toContain(">= 20 then");
    expect(sql).toContain("exception when unique_violation then");
    expect(sql).toContain("content_excerpt text");
    expect(sql).toContain("post_id uuid references public.posts(id) on delete set null");
    expect(sql).toContain("using (blocker_id = (select auth.uid()))");
    expect(sql).toContain("create policy \"org_wall_header\" on public.content_reports as restrictive for all");
    // nothing is deleted except by a handler through remove_reported_content
    expect((sql.match(/delete from public\.(posts|comments)/g) ?? []).length).toBe(2);
    expect(sql).toContain("create or replace function public.remove_reported_content");
  });

  it("a notice for the coaches is pushed with nothing on the lock screen but 'Open the app to review it.'", () => {
    const push = src("lib/notification-push.ts");
    expect(push).toContain('"content_reported"');
    expect(push).toContain('content_reported: "Open the app to review it."');
  });
});
