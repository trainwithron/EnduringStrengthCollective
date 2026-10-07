import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { describeScheduleRequests, matchScheduleRequestQuestion } from "./schedule-requests-chat";

describe("Ask Spot can show schedule requests, read-only", () => {
  it("recognises a plain question about them", () => {
    for (const q of ["any schedule requests?", "show me the schedule requests", "who asked to pause", "are there pause requests", "show Sam's freeze requests", "pending cancel requests", "who wants to cancel"]) {
      expect(matchScheduleRequestQuestion(q), q).not.toBeNull();
    }
  });
  it("leaves settings commands, how-to questions and unrelated messages alone", () => {
    for (const q of ["set my buffer to 10 minutes", "change clients to athletes", "how do I pause a client's schedule", "open Sam's program", "what is my revenue", "let clients book themselves"]) {
      expect(matchScheduleRequestQuestion(q), q).toBeNull();
    }
  });
  it("describes what is waiting in one plain sentence per client, with no note and no money", () => {
    const t = describeScheduleRequests([
      { clientName: "Sam Lee", kind: "pause", effectiveOn: "2026-11-03", resumeOn: null },
      { clientName: "Kim Wu", kind: "freeze", effectiveOn: "2026-11-10", resumeOn: "2026-12-01" },
      { clientName: "Al Roe", kind: "cancel", effectiveOn: "2026-11-12", resumeOn: null },
    ]);
    expect(t).toContain("3 schedule requests are waiting");
    expect(t).toContain("Sam Lee asked to pause (sessions stay through Nov 3)");
    expect(t).toContain("Kim Wu asked to freeze until Dec 1 (sessions stay through Nov 10)");
    expect(t).toContain("Al Roe asked to end (sessions stay through Nov 12)");
    expect(t).not.toMatch(/credit|refund|owe|pay|\$/i);
    expect(describeScheduleRequests([])).toBe("No schedule requests are waiting.");
    expect(describeScheduleRequests([{ clientName: "Sam Lee", kind: "pause", effectiveOn: "2026-11-03", resumeOn: null }])).toContain("1 schedule request is waiting");
  });
  it("shows at most eight and says how many more", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ clientName: `C${i}`, kind: "pause" as const, effectiveOn: "2026-11-03", resumeOn: null }));
    expect(describeScheduleRequests(many)).toContain("and 3 more");
  });
  it("the route answers only for coaches, only reads (never the note table, never a change), and the question is checked after the settings commands", () => {
    const route = readFileSync(new URL("../app/api/assistant/navigate/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const start = route.indexOf("if (role === \"coach\" && matchScheduleRequestQuestion(message))");
    const block = route.slice(start, route.indexOf("const clientPrograms"));
    expect(start).toBeGreaterThan(0);
    expect(block).toContain('.from("schedule_requests")');
    expect(block).not.toContain("schedule_request_notes");
    expect(block).not.toMatch(/\.rpc\(|\.update\(|\.insert\(|\.delete\(/);
    expect(route.indexOf("proposeAction(")).toBeLessThan(start);
  });
});
