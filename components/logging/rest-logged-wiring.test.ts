import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const grid = readFileSync(new URL("./exercise-set-grid.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// R7: the rest the coach prescribed is written into the set's log when the set completes, so the logged history (and the session-length check) carry it.
describe("a completed set logs the rest that was prescribed", () => {
  it("the completion step gets the prescribed seconds, only from the coach", () => {
    expect(grid).toContain("prescribedRestSeconds={(() => {");
    expect(grid).toContain('return r?.source === "coach" ? r.seconds : null;');
  });
  it("it is written only on completion, and never over a rest the client typed", () => {
    expect(grid).toContain('patch.status === "completed" && prescribedRestSeconds != null && set.restSeconds == null');
    expect(grid).toContain("payload[ACTUAL_COLUMN.rest] = withRest.restSeconds;");
  });
  it("a prescribed rest still does not have to be typed for the set to complete", () => {
    expect(grid).toContain('.filter((f) => !(restPrescribed && f === "rest"))');
  });
});
