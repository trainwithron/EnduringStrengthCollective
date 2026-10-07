import { describe, it, expect } from "vitest";
import { trackAiRun, noteAiAttempt, everyAiCallFailed } from "./ai-run-stats";

describe("AI run stats", () => {
  it("counts a run where every call failed", async () => {
    const stats = await trackAiRun(async (s) => {
      noteAiAttempt({ ok: false, errorClass: "credit" });
      noteAiAttempt({ ok: false, errorClass: "credit" });
      return s;
    });
    expect(stats.attempts).toBe(2);
    expect(everyAiCallFailed(stats)).toBe(true);
    expect(stats.lastClass).toBe("credit");
  });
  it("one success means it did not all fail, and a run with no calls is not a failure", async () => {
    const mixed = await trackAiRun(async (s) => {
      noteAiAttempt({ ok: true });
      noteAiAttempt({ ok: false });
      return s;
    });
    expect(everyAiCallFailed(mixed)).toBe(false);
    const none = await trackAiRun(async (s) => s);
    expect(everyAiCallFailed(none)).toBe(false);
  });
  it("is a no-op outside a run, and two runs never count each other", async () => {
    noteAiAttempt({ ok: false });
    const [a, b] = await Promise.all([
      trackAiRun(async (s) => { await Promise.resolve(); noteAiAttempt({ ok: false }); return s; }),
      trackAiRun(async (s) => { await Promise.resolve(); noteAiAttempt({ ok: true }); noteAiAttempt({ ok: true }); return s; }),
    ]);
    expect(a.attempts).toBe(1);
    expect(b.attempts).toBe(2);
    expect(everyAiCallFailed(a)).toBe(true);
    expect(everyAiCallFailed(b)).toBe(false);
  });
});
