import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNewRequest, parseBuildRequest } from "@/lib/ai-day-request";
import { SAVING_API } from "@/lib/workspace-mutation";

// Follow-ups to the builder chat (Commander, Nov 24).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("a program's conversation lives as long as the program", () => {
  const cron = read("app/api/cron/coach-chat-cleanup/route.ts");
  it("the 90-day cleanup skips threads that belong to a program, in the read and in the delete", () => {
    expect(cron).toContain('.select("id")\n    .is("program_id", null)\n    .lt("last_message_at", cutoff.toISOString());');
    expect(cron).toContain('.delete().in("id", expiredIds).is("program_id", null);');
    expect(cron).toContain("const RETENTION_DAYS = 90;");
  });
  it("deleting the program removes its threads, and a thread's messages go with it", () => {
    expect(read("supabase/migrations/0164_ai_program_conversational_learning.sql")).toContain("add column program_id uuid references public.programs(id) on delete cascade;");
    expect(read("supabase/migrations/0153_collective_intelligence_chat.sql")).toContain("thread_id uuid not null references public.coach_chat_threads(id) on delete cascade,");
  });
});

describe("the program chat panel's routes went with the panel", () => {
  it("they are gone, nothing calls them, and the save-route list no longer names them", () => {
    expect(existsSync(join(__dirname, "..", "app/api/ai/program-chat/route.ts"))).toBe(false);
    expect(existsSync(join(__dirname, "..", "app/api/ai/program-chat/confirm-rule/route.ts"))).toBe(false);
    expect(SAVING_API.source).not.toContain("program-chat");
    expect(read("components/coach/desktop/program-builder-chat.tsx")).not.toContain("/api/ai/program-chat");
  });
});

describe('"N day" followed by a split name is that many days a week', () => {
  it("upper lower, full body, PPL, push pull legs, bro split", () => {
    expect(parseBuildRequest("4 day upper lower").daysPerWeek).toBe(4);
    expect(parseBuildRequest("4 day upper/lower").daysPerWeek).toBe(4);
    expect(parseBuildRequest("4-day upper-lower for a beginner").daysPerWeek).toBe(4);
    expect(parseBuildRequest("3 day full body").daysPerWeek).toBe(3);
    expect(parseBuildRequest("three day full-body program").daysPerWeek).toBe(3);
    expect(parseBuildRequest("6 day PPL").daysPerWeek).toBe(6);
    expect(parseBuildRequest("6 day push pull legs").daysPerWeek).toBe(6);
    expect(parseBuildRequest("6 day push/pull/legs").daysPerWeek).toBe(6);
    expect(parseBuildRequest("5 day bro split").daysPerWeek).toBe(5);
    expect(isNewRequest("4 day upper lower")).toBe(true);
  });
  it("the earlier rules still win", () => {
    expect(parseBuildRequest("a 28-day program, 4 days a week").daysPerWeek).toBe(4);
    expect(parseBuildRequest("a 28 day full body program, 3x a week").daysPerWeek).toBe(3);
    expect(parseBuildRequest("5 days a week, a 3 day full body block and 2 mobility days").daysPerWeek).toBe(5);
    expect(parseBuildRequest("5 day split 3 day a week full body workouts then 2 days a week will be Mobility").daysPerWeek).toBe(5);
    expect(parseBuildRequest("upper lower for a beginner").daysPerWeek).toBeNull();
    // the number of weeks is not read as days
    expect(parseBuildRequest("4 week full body").daysPerWeek).toBeNull();
  });
});
