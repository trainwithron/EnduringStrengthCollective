import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A workout started by mistake can be deleted from the same choice as Complete / Pause / Keep going.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const complete = read("components/session/complete-workout-button.tsx");

describe("Delete workout", () => {
  it("a quieter fourth button in the choice, after Keep going", () => {
    const choice = complete.slice(complete.indexOf("{confirming && !deleteAsked && ("), complete.indexOf("{error && ("));
    expect(choice.indexOf("Keep going")).toBeLessThan(choice.indexOf("Delete workout"));
    expect(choice).toContain('className="h-11 px-1 font-body text-xs text-steel underline underline-offset-2 sm:ml-auto"');
    expect(choice).toContain("setDeleteAsked(true)");
  });
  it("asks once: Delete this workout? Nothing is saved and no session is used. (Delete / Cancel)", () => {
    const ask = complete.slice(complete.indexOf("{confirming && deleteAsked && ("), complete.indexOf("{confirming && !deleteAsked && ("));
    expect(ask).toContain("Delete this workout? Nothing is saved and no session is used.");
    expect(ask).toContain('{submitting ? "Deleting…" : "Delete"}');
    expect(ask).toContain("Cancel");
    expect(ask).toContain("onClick={() => setDeleteAsked(false)}");
  });
  it("deletes only this workout and only while it is still in progress, then leaves the way Pause does; nothing else is written (the booking is untouched)", () => {
    const del = complete.slice(complete.indexOf("async function handleDelete()"), complete.indexOf("async function handleComplete()"));
    expect(del).toContain('.from("athlete_sessions").delete().eq("id", sessionId).eq("status", "in_progress").select("id")');
    expect(del).toContain("router.push(pauseHref)");
    expect(del).not.toContain("bookings");
    expect(del).not.toContain("rpc(");
    expect(del.match(/\.from\(/g)?.length).toBe(1);
  });
  it("a refused or failed delete says so and stays", () => {
    const del = complete.slice(complete.indexOf("async function handleDelete()"), complete.indexOf("async function handleComplete()"));
    expect(del).toContain("if (deleteError || !data || data.length === 0) {");
    expect(del).toContain("This workout couldn't be deleted. Nothing was changed.");
  });
});
