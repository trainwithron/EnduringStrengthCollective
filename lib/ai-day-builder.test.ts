import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("The AI Program Builder box", () => {
  const box = read("components/coach/desktop/ai-program-builder-box.tsx");
  it("says what Ron approved, and never the word draft", () => {
    for (const text of [
      "AI Program Builder",
      "Saved as you go. Nothing reaches the client until you assign it.",
      "Tell it what to build, or say: finish the week using Day 1",
      ">\n            Ask\n",
      "Pause",
      "Resume",
      "Paused. Tell it what to change, then Resume.",
      "Done. Your days are in the builder.",
      "Couldn't build that day. Try Resume, or tell it what to change.",
    ]) expect(box, text).toContain(text);
    expect(box.toLowerCase()).not.toContain("draft");
    expect(read("app/api/ai/build-day/route.ts").toLowerCase()).not.toContain("draft");
  });
  it("builds one day per call, shows each finished day in the builder, and pause keeps what is built", () => {
    expect(box).toContain('callDay("build", slot)');
    expect(box).toContain("await show(result.workoutId);");
    expect(box).toContain("if (pauseRequested.current)");
    expect(box).toContain("queue.current.shift();");
    // pausing never removes anything: there is no delete anywhere in the box
    expect(box).not.toContain(".delete(");
  });
  it("a correction is sent with every later day and fixes only the day it points at", () => {
    expect(box).toContain("corrections.current = [...corrections.current, said];");
    expect(box).toContain('callDay("fix", target)');
    expect(box).toContain("fixTargetFrom(said)");
    expect(box).toContain("corrections: corrections.current");
  });
  it("sits at the top of the full builder, not the small embedded copy, and the builder draws the day it makes", () => {
    const builder = read("components/coach/desktop/program-builder-desktop.tsx");
    expect(builder).toContain("<AiProgramBuilderBox");
    expect(builder).toMatch(/\{!embedded && \(\n\s+<AiProgramBuilderBox/);
    expect(builder).toContain("function handleAiDay(day: BuilderDay)");
    // Import program lives inside the AI box now (above the mic and Ask), not as a link in the toolbar
    expect(builder).not.toContain("Import a program");
    expect(read("components/coach/desktop/ai-program-builder-box.tsx")).toContain("<ProgramImportLauncher groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} />");
  });
});

describe("The route that builds a day", () => {
  const route = read("app/api/ai/build-day/route.ts");
  it("is one short call: 60 second platform limit, 50 second limit of its own", () => {
    expect(route).toContain("export const maxDuration = 60;");
    expect(route).toContain("attempt(null, 50_000)");
    expect(route).toContain("55_000 - elapsed - 4_000");
    expect(route).toContain('feature: "program_day"');
  });
  it("only coaches of the program's group, and a day that already has exercises is never overwritten in build mode", () => {
    expect(route).toContain('membership?.role !== "coach"');
    expect(route).toContain('mode === "build" && target?.hasExercises');
    expect(route).toContain("status: 409");
    expect(route).toContain('mode === "fix" && target');
  });
  it("charges once per run (on its first day) with the same allowance and credits as a whole program", () => {
    expect(route).toContain("if (!run.ok) {\n    const canRun = await canRunAiAction(supabase, user.id, \"program_generation\");");
    expect(route).toContain('if (!run.ok) {\n      const spend = await checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "program_generation");');
  });
  it("keeps the injury and under-18 rules and the coach's corrections as hard rules", () => {
    expect(route).toContain("hasFlaggedMusculoskeletalConcern");
    expect(route).toContain("YOUTH_PROMPT_BLOCK");
    expect(read("lib/ai-day-run.ts")).toContain("HARD requirement");
  });
});

describe("Build program and New program make the program at once", () => {
  it("the New program page has no form or choice: it creates the program and opens the builder", () => {
    const page = read("app/(coach)/groups/[groupId]/programs/new/page.tsx");
    expect(page).toContain("<CreateAndOpenProgram");
    expect(page).not.toContain("NewProgramForm");
    expect(page).not.toContain("Start blank");
    expect(page).not.toContain("Build with AI");
    // an old ?method=ai link does the same thing now: the builder opens with its AI box (there is no import page to send it to)
    expect(page).not.toContain('searchParams.method === "ai"');
    expect(page).not.toContain("programs/import");
  });
  it("the name is [First name]'s program for a client and New program otherwise, made in the browser, once", () => {
    const c = read("components/coach/create-and-open-program.tsx");
    expect(c).toContain("`${athleteFirstName}'s program`");
    expect(c).toContain('"New program"');
    expect(c).toContain("if (started.current) return;");
    expect(c).toContain("router.replace(`/groups/${groupId}/programs/${id}?edit=1");
    // and once even when the page is mounted twice in a row (two were made 5 ms apart on Oct 26)
    expect(c).toContain("const id = await startOnce(");
  });
  it("the Programs page no longer has the Import or build with AI button (one + New program stays)", () => {
    const page = read("app/(coach)/programs/page.tsx");
    expect(page).not.toContain("Import or build with AI");
    expect(page).toContain("+ New program");
  });
});

describe("Fixing a day never leaves it empty", () => {
  it("the new exercises are written first and the old ones removed only after they are in", () => {
    const route = read("app/api/ai/build-day/route.ts");
    expect(route).toContain("const oldIds: string[] =");
    expect(route.indexOf("newIds.push(ex.id as string);")).toBeLessThan(route.indexOf('delete().in("id", oldIds)'));
    expect(route).toContain('delete().in("id", newIds)');
    expect(route).not.toContain('.delete().eq("workout_id", workoutId)');
  });
});

describe("A run token cannot be used again to skip the charge", () => {
  it("a token is stale when the log shows more days built under it than it counts", async () => {
    const { runTokenIsStale } = await import("@/lib/ai-day-run");
    expect(runTokenIsStale(2, 2)).toBe(false);
    expect(runTokenIsStale(0, 2)).toBe(false);
    expect(runTokenIsStale(3, 2)).toBe(true);
  });
  it("the route checks the log before trusting a token, and a new run's token starts counting before its first day is logged", () => {
    const route = read("app/api/ai/build-day/route.ts");
    expect(route).toContain("if (runTokenIsStale(count ?? 0, run.days)) run = { ok: false };");
    expect(route).toContain('.eq("feature", "program_day")');
    expect(route).toContain('.neq("status", "error")');
    expect(route).toContain("run.ok ? run.issuedAt : startedAt");
    expect(route.indexOf("const startedAt = Date.now();")).toBeLessThan(route.indexOf("await callClaude("));
  });
});
