import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadSharedSource } from "./shared-workout-source";

// A tiny stand-in for the database client: each table answers with what the test gives it, for any filter.
function fakeDb(tables: Record<string, any>) {
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: tables[table] ?? null }),
      };
      return chain;
    },
  } as any;
}

describe("the card source", () => {
  it("uses the feed post when there is one", async () => {
    const post = { id: "p1", group_id: "g", author_id: "a", broadcast_level: "prs_only", workout_logs: { session_id: "s", new_prs: [], total_volume: 100, total_sets_completed: 3 } };
    const r = await loadSharedSource(fakeDb({ posts: post }), "p1");
    expect(r?.post.id).toBe("p1");
    expect(r?.post.broadcast_level).toBe("prs_only");
  });

  it("builds the card from the workout log when the workout has no feed post (private or one-on-one client), in full", async () => {
    const log = { id: "l1", athlete_id: "a", group_id: "g", session_id: "s", new_prs: ["Back Squat"], total_volume: 4800, total_sets_completed: 6, created_at: "2026-10-06T12:00:00Z" };
    const r = await loadSharedSource(fakeDb({ posts: null, workout_logs: log, profiles: { full_name: "Sam Lee", avatar_url: null } }), "l1");
    expect(r?.post).toMatchObject({ id: "l1", post_type: "workout_summary", group_id: "g", author_id: "a", broadcast_level: "full", shared_exercise_names: null });
    expect((r?.post.profiles as any).full_name).toBe("Sam Lee");
    expect(r?.workoutLog).toEqual({ session_id: "s", new_prs: ["Back Squat"], total_volume: 4800, total_sets_completed: 6 });
  });

  it("does not build a card from a bare workout id: only a signed link opens a card the client did not post", async () => {
    const log = { id: "l1", athlete_id: "a", group_id: "g", session_id: "s", new_prs: [], total_volume: 1, total_sets_completed: 1, created_at: "2026-10-06T12:00:00Z" };
    expect(await loadSharedSource(fakeDb({ posts: null, workout_logs: log, profiles: { full_name: "Sam" } }), "l1", false)).toBeNull();
    expect(await loadSharedSource(fakeDb({ posts: null, workout_logs: log, profiles: { full_name: "Sam" } }), "l1", true)).not.toBeNull();
  });

  it("finds nothing for an id that is neither a post nor a workout, or a workout whose client is gone", async () => {
    expect(await loadSharedSource(fakeDb({}), "x")).toBeNull();
    expect(await loadSharedSource(fakeDb({ workout_logs: { id: "l", athlete_id: null, group_id: "g" } }), "l")).toBeNull();
  });
});

describe("finishing a workout always ends on the card", () => {
  it("goes to the card by the post id, or the workout's own id when there is no post", () => {
    const src = readFileSync(new URL("../components/session/complete-workout-button.tsx", import.meta.url), "utf8");
    expect(src).toContain("/api/share/sign");
    expect(src).toContain("if (postId) navHref = `/share/${postId}`;");
  });
  it("the client's Settings has the sharing control, for group members and not for a one-on-one client", () => {
    const src = readFileSync(new URL("../app/groups/[groupId]/settings/page.tsx", import.meta.url), "utf8");
    expect(src).toContain("Sharing to the group feed");
    expect(src).toContain('client_tier?: string | null } | null)?.client_tier !== "one_on_one"');
    expect(readFileSync(new URL("../components/athlete/feed-broadcast-settings.tsx", import.meta.url), "utf8")).toContain("you still get your workout card to share");
  });
});
