import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { awayReplyState, DEFAULT_AWAY_REPLY, MAX_AWAY_REPLY } from "./away-reply";
import { loadAwayReply } from "./away-reply-data";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("what the away reply card shows", () => {
  it("off with no setting or when switched off", () => {
    expect(awayReplyState(null, "2026-10-20")).toBe("off");
    expect(awayReplyState({ enabled: false, endsOn: null }, "2026-10-20")).toBe("off");
    expect(awayReplyState({ enabled: false, endsOn: "2026-10-24" }, "2026-10-20")).toBe("off");
  });
  it("on until the end of the last day, today included", () => {
    expect(awayReplyState({ enabled: true, endsOn: null }, "2026-10-20")).toBe("on");
    expect(awayReplyState({ enabled: true, endsOn: "2026-10-24" }, "2026-10-24")).toBe("on");
    expect(awayReplyState({ enabled: true, endsOn: "2026-10-24" }, "2026-10-23")).toBe("on");
  });
  it("ended the day after the last day", () => {
    expect(awayReplyState({ enabled: true, endsOn: "2026-10-24" }, "2026-10-25")).toBe("ended");
  });
  it("the starting text fits", () => {
    expect(DEFAULT_AWAY_REPLY.length).toBeLessThan(MAX_AWAY_REPLY);
  });
});

describe("loading the setting", () => {
  const fakeDb = (opts: { error?: boolean; row?: unknown; tz?: string | null }) =>
    ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === "coach_away_replies" ? (opts.error ? { data: null, error: { message: "no table" } } : { data: opts.row ?? null, error: null }) : { data: { timezone: opts.tz ?? null }, error: null },
          }),
        }),
      }),
    }) as any;
  it("returns nothing before the database update (the card is simply not shown)", async () => {
    expect(await loadAwayReply(fakeDb({ error: true }), "c1")).toBeNull();
  });
  it("returns the setting and a date key", async () => {
    const v = await loadAwayReply(fakeDb({ row: { enabled: true, message: "away", ends_on: "2026-10-24" }, tz: "America/Los_Angeles" }), "c1");
    expect(v?.setting).toEqual({ enabled: true, message: "away", endsOn: "2026-10-24" });
    expect(v?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("no row yet is a null setting", async () => {
    expect((await loadAwayReply(fakeDb({}), "c1"))?.setting).toBeNull();
  });
});

describe("wiring", () => {
  it("the coach's Messages page shows the card, the thread marks auto-replies, and the loader tolerates the old database", () => {
    const page = read("app/(coach)/groups/[groupId]/messages/page.tsx");
    expect(page).toContain("loadAwayReply(supabase, user.id)");
    expect(page.indexOf("<AwayReplyCard")).toBeGreaterThan(page.indexOf("if (viewerIsCoach) {"));
    expect(read("components/messages/direct-message-thread.tsx")).toContain("Auto-reply");
    const thread = read("lib/direct-thread.ts");
    expect(thread).toContain("auto_reply");
    expect(thread).toContain("if (first.error)");
  });
  it("one tap turns it off, and no AI is involved", () => {
    const card = read("components/coach/away-reply-card.tsx");
    expect(card).toContain("Turn off");
    expect(card).toContain("onClick={() => void turnOff()}");
    expect(card + read("lib/away-reply.ts") + read("lib/away-reply-data.ts")).not.toMatch(/anthropic|callClaude|\/api\/ai\//i);
  });
  it("the database does the replying, never reads the client's message, and guards against loops and fakes", () => {
    const sql = read("supabase/migrations/0315_away_reply.sql");
    expect(sql).toContain("if new.auto_reply then");
    expect(sql).toContain("interval '5 minutes'");
    expect(sql).toContain("app.away_reply");
    expect(sql).not.toMatch(/new\.body/);
  });
});
