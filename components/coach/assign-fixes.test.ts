import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Assign cannot run twice from a quick double click", () => {
  const panel = read("components/coach/desktop/program-assign-panel.tsx");
  it("the Assign panel's button is guarded by busy, set before the first await", () => {
    expect(panel).toContain("if (busy || count === 0) return;");
    expect(panel.indexOf("setBusy(true);\n    setError(null);\n    setMessage(null);")).toBeLessThan(panel.indexOf("await ensureSignedOff("));
    expect(panel).toContain("disabled={busy || count === 0}");
  });
  it("the client's Programs-tab picker has the same guard", () => {
    const actions = read("components/coach/client-program-actions.tsx");
    expect(actions).toContain("if (busyId || assigning.current) return;");
    expect(actions.indexOf("assigning.current = true")).toBeLessThan(actions.indexOf("await assignOnce(program)"));
  });
});

describe("the assigned message matches what happened", () => {
  const panel = read("components/coach/desktop/program-assign-panel.tsx");
  it("says how many people got their own version, and lists the failures", () => {
    // people and groups (an organization program can go to a group, Oct 26)
    expect(panel).toContain("ok > 0 ? `${ok} ${ok === 1 ? \"person\" : \"people\"}` : null");
    expect(panel).toContain("setMessage(parts.length > 0 ? `Assigned to ${parts.join(\" and \")}.` : null);");
    expect(panel).toContain("Couldn't assign to");
  });
});

describe("assign only attaches inside one organization", () => {
  it("the migration compares the two groups' organizations before attaching", () => {
    const sql = read("supabase/migrations/0337_assign_same_org_only.sql");
    expect(sql).toContain("and v_src_org is not distinct from v_dest_org");
    expect(sql).not.toMatch(/delete from|drop table/);
  });
});

describe("a prospect is never silently left unnotified", () => {
  const lib = read("lib/trainer-dispatch-advance.ts");
  it("a failed or unconfigured email is logged plainly and the trainer is told", () => {
    expect(lib).toContain("async function emailProspect(");
    expect(lib).toContain("console.error(`[dispatch] the ${what} email was not sent");
    expect(lib).toContain("Booked. We couldn't email ${request.prospect_name} to confirm, so please let them know yourself: ${request.prospect_email}");
    expect(lib).toContain("Your question was saved, but we couldn't email ${request.prospect_name}. Please contact them yourself: ${request.prospect_email}");
    // the log line carries no address
    expect(lib.slice(lib.indexOf("async function emailProspect("), lib.indexOf("export async function acceptDispatchStep"))).not.toContain("prospect_email");
  });
  it("the routes pass the notice on and the buttons show it", () => {
    expect(read("app/api/org-dispatch/accept/route.ts")).toContain("notice: result.notice");
    expect(read("app/api/org-dispatch/ask-question/route.ts")).toContain("notice: result.notice");
    expect(read("components/coach/dispatch-step-actions.tsx")).toContain("confirmDialog({ message: data.notice");
  });
});
