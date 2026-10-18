import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPostWorkoutCards, loadPostWorkoutCardsMany, postWorkoutCardsOn } from "@/lib/post-workout-cards";
import { feedChannel, shouldPostToFeed } from "@/lib/announce-workout-log";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// A tiny stand-in for the database client: each .from("groups").select(cols)... call answers from a script keyed by the columns asked for.
function fakeDb(answers: Record<string, { data: unknown; error: unknown }>) {
  const calls: string[] = [];
  const db = {
    from(table: string) {
      expect(table).toBe("groups");
      return {
        select(cols: string) {
          calls.push(cols);
          const res = answers[cols] ?? { data: null, error: { message: "unexpected" } };
          const chain: any = {
            eq: () => chain,
            in: () => Promise.resolve(res),
            maybeSingle: () => Promise.resolve(res),
          };
          return chain;
        },
      };
    },
  };
  return { db: db as any, calls };
}

describe("CS1: the setting's default", () => {
  it("empty means off for a team-sport group and on for every other group; a coach's choice always wins", () => {
    expect(postWorkoutCardsOn(null, true)).toBe(false);
    expect(postWorkoutCardsOn(undefined, true)).toBe(false);
    expect(postWorkoutCardsOn(null, false)).toBe(true);
    expect(postWorkoutCardsOn(null, null)).toBe(true);
    expect(postWorkoutCardsOn(true, true)).toBe(true);
    expect(postWorkoutCardsOn(false, false)).toBe(false);
  });

  it("reads one group's setting, and falls back to the team default when the column is not there yet", async () => {
    const a = fakeDb({ "post_workout_cards, team_mode": { data: { post_workout_cards: null, team_mode: true }, error: null } });
    expect(await loadPostWorkoutCards(a.db, "g")).toBe(false);
    const b = fakeDb({
      "post_workout_cards, team_mode": { data: null, error: { message: "column groups.post_workout_cards does not exist" } },
      team_mode: { data: { team_mode: false }, error: null },
    });
    expect(await loadPostWorkoutCards(b.db, "g")).toBe(true);
    const c = fakeDb({
      "post_workout_cards, team_mode": { data: null, error: { message: "no column" } },
      team_mode: { data: { team_mode: true }, error: null },
    });
    expect(await loadPostWorkoutCards(c.db, "g")).toBe(false);
  });

  it("reads many groups at once", async () => {
    const a = fakeDb({
      "id, post_workout_cards, team_mode": {
        data: [
          { id: "t", post_workout_cards: null, team_mode: true },
          { id: "c", post_workout_cards: null, team_mode: false },
          { id: "x", post_workout_cards: true, team_mode: true },
        ],
        error: null,
      },
    });
    const m = await loadPostWorkoutCardsMany(a.db, ["t", "c", "x", "t"]);
    expect([m.get("t"), m.get("c"), m.get("x")]).toEqual([false, true, true]);
    expect((await loadPostWorkoutCardsMany(a.db, [])).size).toBe(0);
  });
});

describe("CS1: with the setting off nothing is made; with it on nothing changes", () => {
  it("finishing a workout: the card options are skipPost and skipLink together when off, and exactly as before when on", () => {
    const s = src("components/session/complete-workout-button.tsx");
    expect(s).toContain("postWorkoutCards = true,");
    expect(s).toContain("const cardsOn = postWorkoutCards;");
    expect(s).toContain("skipPost: !cardsOn || !!coachMode?.clientIsMinor,");
    expect(s).toContain("skipLink: !cardsOn,");
    // when on, the call is the old one: the minor rule is the only reason to skip
    expect(shouldPostToFeed("full", false, false)).toBe(true);
    expect(shouldPostToFeed("full", false, true)).toBe(false);
    expect(feedChannel("full", true)).toBe("pr_board");
  });

  it("the session page reads the group's setting and hands it down to the button", () => {
    expect(src("app/sessions/[sessionId]/page.tsx")).toContain("await loadPostWorkoutCards(supabase, session.group_id)");
    expect(src("app/sessions/[sessionId]/page.tsx")).toContain("postWorkoutCards={postWorkoutCards}");
    const logger = src("components/logging/session-logger.tsx");
    expect(logger).toContain("postWorkoutCards?: boolean;");
    expect(logger).toContain("postWorkoutCards = true,");
    expect(logger).toContain("postWorkoutCards={postWorkoutCards}");
  });

  it("counting an imported record: the answer makes no card or post when the group has them off, and is unchanged when on", () => {
    const card = src("components/pr-promotion/answer-card.tsx");
    expect(card).toContain("postCard = true");
    expect(card).toContain("if (!postCard) {");
    // the record itself is still counted (the database answer comes first), only the announcement is skipped
    expect(card.indexOf('rpc("answer_pr_promotion"')).toBeLessThan(card.indexOf("if (!postCard) {"));
    expect(card.indexOf("if (!postCard) {")).toBeLessThan(card.indexOf("announceWorkoutLog(supabase"));
    expect(src("app/pr-promotion/[id]/page.tsx")).toContain("postCard={cardsOn}");
  });

  it("the weekly milestone scan records and tells no one for a group with the setting off", () => {
    const scan = src("app/api/cron/milestone-scan/route.ts");
    const start = scan.indexOf("async function recordMilestone(");
    const body = scan.slice(start, scan.indexOf("async function alreadyFiredRecently("));
    expect(body).toContain("if (!(await loadPostWorkoutCards(supabase, groupId))) return false;");
    expect(body.indexOf("loadPostWorkoutCards(")).toBeLessThan(body.indexOf('.from("milestone_events")'));
    expect(body.indexOf("loadPostWorkoutCards(")).toBeLessThan(body.indexOf('.from("notifications")'));
  });
});

describe("CS1: the Settings switch", () => {
  it("is a plain, labelled switch in the group's Settings that saves the explicit choice and puts itself back on a failed save", () => {
    const t = src("components/coach/post-workout-cards-toggle.tsx");
    expect(t).toContain("Post-workout cards and PR notices");
    expect(t).toContain("Off: finishing a workout makes no feed card and no share card");
    expect(t).toContain("update({ post_workout_cards: next })");
    expect(t).toContain("setEnabled(!next);");
    const s = src("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(s).toContain("<PostWorkoutCardsToggle groupId={params.groupId} initialEnabled={postWorkoutCards} />");
    // read apart from the group row, so the page still loads on a database without the column
    expect(s).toContain("await loadPostWorkoutCards(supabase, params.groupId)");
    expect(s).not.toContain('select("gamification_enabled, name, group_kind, post_workout_cards');
  });

  it("the paste is one additive nullable column: a team-sport group starts off, every other group starts as it was", () => {
    const m = src("supabase/migrations/0414_group_post_workout_cards.sql");
    expect(m).toContain("add column if not exists post_workout_cards boolean;");
    const alter = m.split("\n").find((l) => l.startsWith("alter")) ?? "";
    expect(alter).not.toMatch(/not null|default/i);
  });
});
